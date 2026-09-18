'use strict';

function clean(value) {
  return value == null ? '' : String(value);
}

function channelRow(channel) {
  const id = clean(channel?.id?._serialized || channel?.id);
  const name = clean(channel?.name);
  const description = clean(channel?.description);
  const meta = channel?.channelMetadata || {};
  const last = channel?.lastMessage;
  return {
    id,
    name,
    description,
    isChannel: channel?.isChannel === true,
    isReadOnly: channel?.isReadOnly === true,
    isMuted: channel?.isMuted === true,
    timestamp: channel?.timestamp || null,
    unreadCount: Number(channel?.unreadCount || 0),
    lastMessage: last ? {
      id: clean(last.id?._serialized || last.id),
      body: clean(last.body),
      timestamp: last.timestamp || null,
      type: clean(last.type)
    } : null,
    metadata: {
      verified: meta?.verified ?? null,
      subscriberCount: Number.isFinite(Number(meta?.subscribersCount))
        ? Number(meta.subscribersCount) : null
    }
  };
}

class PublicChannelSearch {
  constructor() {}

  async search(client, options = {}) {
    if (!client || typeof client.searchChannels !== 'function') {
      throw new Error('This whatsapp-web.js runtime does not expose public channel search');
    }

    const searchText = clean(options.searchText).trim();
    const countryCodes = Array.isArray(options.countryCodes)
      ? options.countryCodes.map(x => clean(x).replace(/\D/g, '')).filter(Boolean).slice(0, 20)
      : [];
    const limit = Math.min(100, Math.max(1, Number(options.limit || 20)));
    const view = Number.isFinite(Number(options.view)) ? Number(options.view) : undefined;
    const skipSubscribedNewsletters = options.skipSubscribedNewsletters !== false;

    const channels = await client.searchChannels({
      searchText,
      countryCodes,
      skipSubscribedNewsletters,
      ...(view === undefined ? {} : { view }),
      limit
    });

    const rows = (Array.isArray(channels) ? channels : [])
      .filter(channel => channel?.isChannel !== false)
      .map(channelRow);

    return {
      query: {
        searchText,
        countryCodes,
        skipSubscribedNewsletters,
        limit,
        ...(view === undefined ? {} : { view })
      },
      count: rows.length,
      rows,
      searchedAt: new Date().toISOString()
    };
  }
}

module.exports = { PublicChannelSearch, channelRow };
