// Generated from pixelito-protocol src/protocol.ts (commit 724ee4c) with tsc, target ES2022. Do not edit by hand.
/**
 * Pixelito bridge protocol, version 1.
 *
 * Messages travel between the host app and the emulator iframe with
 * `postMessage`. Every message is a plain object: `{ pixelito: 1, type, ...fields }`.
 * Receivers must validate with `parseMessage` and check the sender with
 * `isTrustedSender` before acting on anything.
 */
export const PROTOCOL_VERSION = 1;
const MAX_STRING = 256;
const MAX_LIST = 1024;
const MAX_DIMENSION = 4096;
/** Limits for save bytes; a message over any of them is refused whole, never truncated. */
export const MAX_SAVE_FILES = 64;
export const MAX_SAVE_FILE_BYTES = 1024 * 1024;
export const MAX_SAVE_TOTAL_BYTES = 4 * 1024 * 1024;
const KEY_CODE = /^[A-Za-z0-9]{1,32}$/;
const GAME_ID = /^[A-Za-z0-9._-]{1,64}$/;
const isString = (v, max = MAX_STRING) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isDimension = (v) => Number.isInteger(v) && v > 0 && v <= MAX_DIMENSION;
/** A save path is `/<app name>/rms/<file>`: absolute, no `..`, no empty segments, no backslashes. */
export function isSavePath(v) {
    if (!isString(v) || v.includes('\\') || v.includes('\0'))
        return false;
    const parts = v.split('/');
    return parts.length >= 4 && parts[0] === '' && parts[2] === 'rms' && parts.slice(1).every((p) => p !== '' && p !== '.' && p !== '..');
}
const isSaveBlobs = (v) => {
    if (!Array.isArray(v) || v.length > MAX_SAVE_FILES)
        return false;
    let total = 0;
    for (const f of v) {
        if (!isPlainObject(f) || !isSavePath(f.path) || !(f.data instanceof ArrayBuffer))
            return false;
        const size = f.data.byteLength;
        total += size;
        if (size > MAX_SAVE_FILE_BYTES || total > MAX_SAVE_TOTAL_BYTES)
            return false;
    }
    return true;
};
/** The game's save directory name, one path segment: the part between the first two slashes of a save path. */
export const isAppName = (v) => isString(v, 128) && v !== '.' && v !== '..' && !v.includes('/') && !v.includes('\\') && !v.includes('\0');
const isGameId = (v) => typeof v === 'string' && GAME_ID.test(v);
const hostValidators = {
    hello: () => true,
    key: (m) => (m.action === 'down' || m.action === 'up') && typeof m.code === 'string' && KEY_CODE.test(m.code),
    'list-saves': (m) => typeof m.id === 'string' && GAME_ID.test(m.id),
    'export-save': (m) => isGameId(m.id) && isAppName(m.app),
    'import-save': (m) => isGameId(m.id) && isSaveBlobs(m.files),
};
const emulatorValidators = {
    ready: (m) => Array.isArray(m.capabilities) && m.capabilities.length <= MAX_LIST && m.capabilities.every((c) => isString(c, 64)),
    started: (m) => isDimension(m.width) && isDimension(m.height),
    saves: (m) => typeof m.id === 'string' &&
        GAME_ID.test(m.id) &&
        Array.isArray(m.files) &&
        m.files.length <= MAX_LIST &&
        m.files.every((f) => isPlainObject(f) && isString(f.path)),
    'save-data': (m) => isGameId(m.id) && isSaveBlobs(m.files),
    'import-result': (m) => isGameId(m.id) && Number.isInteger(m.imported) && m.imported >= 0 && m.imported <= MAX_SAVE_FILES,
    error: (m) => m.code === 'unknown-type' || m.code === 'bad-key' || m.code === 'save-failed',
};
function isPlainObject(v) {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
        return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}
export function parseMessage(data, direction) {
    if (!isPlainObject(data) || !Object.hasOwn(data, 'pixelito'))
        return { ok: false, reason: 'not-envelope' };
    if (data.pixelito !== PROTOCOL_VERSION)
        return { ok: false, reason: 'unsupported-version' };
    const validators = direction === 'host-to-emulator' ? hostValidators : emulatorValidators;
    const type = data.type;
    if (typeof type !== 'string' || !Object.hasOwn(validators, type))
        return { ok: false, reason: 'unknown-type' };
    if (!validators[type](data))
        return { ok: false, reason: 'invalid-fields' };
    return { ok: true, message: pick(type, data) };
}
const KNOWN_FIELDS = {
    hello: [],
    key: ['action', 'code'],
    'list-saves': ['id'],
    'export-save': ['id', 'app'],
    'import-save': ['id', 'files'],
    'save-data': ['id', 'files'],
    'import-result': ['id', 'imported'],
    ready: ['capabilities'],
    started: ['width', 'height'],
    saves: ['id', 'files'],
    error: ['code'],
};
function pick(type, data) {
    const out = { type };
    const withBytes = type === 'import-save' || type === 'save-data';
    for (const k of KNOWN_FIELDS[type]) {
        out[k] = k === 'files' ? data.files.map((f) => (withBytes ? { path: f.path, data: f.data } : { path: f.path })) : data[k];
    }
    return out;
}
/** Build a message with the protocol version attached. */
export function envelope(message) {
    return { pixelito: PROTOCOL_VERSION, ...message };
}
/**
 * A sender is trusted only when its origin matches one of the fixed allowed
 * origins exactly AND its window is the one we expect (the iframe for the
 * host, `window.parent` for the emulator). The allowlist must be compiled in,
 * never read from a URL or from a message.
 */
export function isTrustedSender(event, allowedOrigins, expectedSource) {
    if (expectedSource === null || expectedSource === undefined)
        return false;
    if (event.source !== expectedSource)
        return false;
    return allowedOrigins.includes(event.origin);
}
