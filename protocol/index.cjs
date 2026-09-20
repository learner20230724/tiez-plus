'use strict';
const VERSION = 1;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_PACKET_BYTES = MAX_TEXT_BYTES * 7; // JSON escapes can expand control characters sixfold.
const ACK_TIMEOUT_MS = 10000;
const REQUEST_TYPES = ['send_text', 'delivery_status', 'get_current', 'get_history', 'get_content', 'ping'];
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
function validId(id) { return typeof id === 'string' && ID.test(id); }
function textBytes(s) {
  let bytes = 0;
  for (let i=0; i<s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i+1<s.length && s.charCodeAt(i+1)>=0xdc00 && s.charCodeAt(i+1)<=0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
function validateRequest(m) {
  if (!m || m.v !== VERSION || !REQUEST_TYPES.includes(m.type)) throw new Error('UNSUPPORTED_PROTOCOL');
  for (const field of ['id', 'requestId', 'from', 'to']) if (!validId(m[field])) throw new Error('INVALID_ID');
  if (m.type === 'send_text') {
    if (typeof m.content !== 'string' || !m.content.trim()) throw new Error('EMPTY_TEXT');
    if (textBytes(m.content) > MAX_TEXT_BYTES) throw new Error('TEXT_TOO_LARGE: 单条文本超过 UTF-8 1 MiB，完整内容已保留，未截断发送');
  }
  if (m.type === 'get_content' && (typeof m.entryId !== 'string' || m.entryId.length > 150)) throw new Error('INVALID_ENTRY');
  return m;
}
function requestTopic(instance, desktop) { return `tiezplus/v1/${instance}/request/${desktop}`; }
function responseTopic(instance, mobile) { return `tiezplus/v1/${instance}/response/${mobile}`; }
function presenceTopic(instance, desktop) { return `tiezplus/v1/${instance}/presence/${desktop}`; }
module.exports = { VERSION, MAX_TEXT_BYTES, MAX_PACKET_BYTES, ACK_TIMEOUT_MS, REQUEST_TYPES, validId, textBytes, validateRequest, requestTopic, responseTopic, presenceTopic };
