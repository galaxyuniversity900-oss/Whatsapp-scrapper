const assert=require('assert');
const {parseTarget}=require('../src/14-group-link-workspace');
assert.deepStrictEqual(parseTarget('https://chat.whatsapp.com/ABC123'),{type:'group',inviteCode:'ABC123'});
assert.deepStrictEqual(parseTarget('https://www.whatsapp.com/channel/XYZ987'),{type:'channel',inviteCode:'XYZ987'});
console.log('RESULT 2/2 passed');
