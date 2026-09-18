'use strict';

const fs = require('fs');
const path = require('path');

function parseTarget(url) {
  const raw = String(url || '').trim();
  if (!raw) throw new Error('WhatsApp group/channel link is required');
  let u;
  try { u = new URL(raw); } catch { throw new Error('Invalid WhatsApp link'); }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'chat.whatsapp.com' && host !== 'whatsapp.com') {
    throw new Error('Only chat.whatsapp.com and whatsapp.com/channel links are supported');
  }
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'chat.whatsapp.com' && parts[0]) return { type: 'group', inviteCode: parts[0] };
  if (host === 'whatsapp.com' && parts[0]?.toLowerCase() === 'channel' && parts[1]) {
    return { type: 'channel', inviteCode: parts[1] };
  }
  throw new Error('Unsupported WhatsApp group/channel link');
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhone(contact) {
  const number = digits(contact?.number || contact?.phone || '');
  if (/^\d{7,15}$/.test(number)) return number;
  const id = String(contact?.id?._serialized || contact?.id || '');
  const fromId = id.split('@')[0];
  return /^\d{7,15}$/.test(fromId) ? fromId : '';
}

function rowFromContact(contact, participant, countryCode) {
  const phone = normalizePhone(contact);
  return {
    name: contact?.name || contact?.pushname || contact?.shortName || '',
    phone,
    countryCode: countryCode ? String(countryCode).replace(/^\+/, '') : (phone ? phone.slice(0, 2) : ''),
    whatsappId: String(participant?.id?._serialized || contact?.id?._serialized || contact?.id || ''),
    admin: !!(participant?.isAdmin || participant?.isSuperAdmin),
    role: participant?.isSuperAdmin ? 'superadmin' : participant?.isAdmin ? 'admin' : 'member',
    isWAContact: contact ? !!contact.isWAContact : null,
    extractedAt: new Date().toISOString()
  };
}

class GroupLinkWorkspace {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  _save(payload) {
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  }

  _load() {
    try { return JSON.parse(fs.readFileSync(this.filePath, 'utf8')); }
    catch { return null; }
  }

  async _findJoinedGroup(client, inviteCode, inviteInfo) {
    const ids = [
      inviteInfo?.id?._serialized,
      inviteInfo?.id,
      inviteInfo?.gid?._serialized,
      inviteInfo?.gid,
      inviteInfo?.groupId?._serialized,
      inviteInfo?.groupId
    ].filter(Boolean).map(String);
    for (const id of ids) {
      try {
        const chat = await client.getChatById(id);
        if (chat?.isGroup) return chat;
      } catch {}
    }

    const chats = await client.getChats();
    for (const chat of chats.filter(x => x?.isGroup)) {
      try {
        if (typeof chat.getInviteCode === 'function' && await chat.getInviteCode() === inviteCode) return chat;
      } catch {}
    }
    return null;
  }

  async extract(client, url, { includeProfiles = false } = {}) {
    const target = parseTarget(url);
    let metadata = { ...target, title: '', id: '', memberCount: 0 };

    if (target.type === 'group') {
      if (typeof client.getInviteInfo !== 'function') throw new Error('This whatsapp-web.js version cannot resolve group invite links');
      const info = await client.getInviteInfo(target.inviteCode);
      const chat = await this._findJoinedGroup(client, target.inviteCode, info);
      if (!chat) {
        throw new Error('The connected account is not currently a member of this group. No private participant data was exposed or bypassed.');
      }
      metadata = {
        ...metadata,
        title: chat.name || info?.subject || '',
        id: chat.id?._serialized || String(chat.id || ''),
        description: chat.description || info?.description || '',
        owner: chat.owner?._serialized || chat.owner || '',
        memberCount: Array.isArray(chat.participants) ? chat.participants.length : 0
      };

      const rows = [];
      for (const participant of chat.participants || []) {
        let contact = null;
        try { contact = await client.getContactById(participant.id?._serialized || String(participant.id || '')); } catch {}
        let countryCode = '';
        try {
          if (contact?.number) countryCode = await client.getCountryCode(contact.number);
        } catch {}
        const row = rowFromContact(contact, participant, countryCode);
        if (includeProfiles && contact) {
          try { row.profilePictureUrl = await contact.getProfilePicUrl(); } catch { row.profilePictureUrl = null; }
          try { row.about = await contact.getAbout(); } catch { row.about = null; }
        }
        rows.push(row);
      }

      const deduped = [...new Map(rows.filter(x => x.whatsappId || x.phone).map(x => [(x.phone || x.whatsappId), x])).values()];
      const payload = this._save({
        version: 1, extractedAt: new Date().toISOString(), source: metadata,
        rows: deduped, total: deduped.length
      });
      return payload;
    }

    if (typeof client.getChannelByInviteCode !== 'function') {
      throw new Error('This whatsapp-web.js version cannot resolve channel links');
    }
    const channel = await client.getChannelByInviteCode(target.inviteCode);
    if (!channel) throw new Error('Channel was not available to the connected account');
    metadata = {
      ...metadata,
      title: channel.name || '',
      id: channel.id?._serialized || String(channel.id || ''),
      description: channel.description || ''
    };
    if (typeof channel.getSubscribers !== 'function') {
      throw new Error('This WhatsApp channel does not expose subscriber listing to the connected account/library');
    }
    const subscribers = await channel.getSubscribers();
    const rows = [];
    for (const item of subscribers || []) {
      const contact = item?.contact || item;
      let countryCode = '';
      try { if (contact?.number) countryCode = await client.getCountryCode(contact.number); } catch {}
      rows.push(rowFromContact(contact, null, countryCode));
    }
    const deduped = [...new Map(rows.filter(x => x.whatsappId || x.phone).map(x => [(x.phone || x.whatsappId), x])).values()];
    const payload = this._save({
      version: 1, extractedAt: new Date().toISOString(), source: metadata,
      rows: deduped, total: deduped.length
    });
    return payload;
  }

  last() { return this._load() || { version: 1, source: {}, rows: [], total: 0 }; }
}

module.exports = { GroupLinkWorkspace, parseTarget };
