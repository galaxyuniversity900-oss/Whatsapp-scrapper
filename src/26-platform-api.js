'use strict';
const {PlatformStore}=require('./19-platform-store');
const {ContactIntelligence}=require('./20-contact-intelligence');
const {WorkspaceCRM}=require('./21-workspace-crm');
const {AutomationEngine}=require('./22-automation-engine');
const {TemplateManager}=require('./23-template-manager');
const {WebhookManager}=require('./24-webhook-manager');
const {BackupManager}=require('./25-backup-manager');
function createPlatform(root){const store=new PlatformStore(root);return {store,contacts:new ContactIntelligence(store),crm:new WorkspaceCRM(store),automations:new AutomationEngine(store),templates:new TemplateManager(store),webhooks:new WebhookManager(store),backups:new BackupManager(require('path').join(root,'backups'),store)};}
module.exports={createPlatform};