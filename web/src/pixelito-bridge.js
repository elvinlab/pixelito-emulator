// Pixelito host bridge: receives protocol messages from the embedding app and
// reports emulator state back. The allowed host origins are compiled in; they
// are never read from the URL or from a message.
import { codeMap } from './key.js';
import {
    envelope,
    isSavePath,
    isTrustedSender,
    MAX_SAVE_FILE_BYTES,
    MAX_SAVE_FILES,
    MAX_SAVE_TOTAL_BYTES,
    parseMessage,
} from './protocol.js';

const ALLOWED_HOST_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173', 'https://elvinlab.github.io'];
const CAPABILITIES = ['key', 'saves-export'];

// CheerpJ keeps the Java file system in this IndexedDB database, one record per path.
const FS_DATABASE = 'cjFS_/files/';
const FS_STORE = 'files';

let hostOrigin = null;
let startedSize = null;

function send(message) {
    window.parent.postMessage(envelope(message), hostOrigin);
}

const request = (req) =>
    new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

/**
 * Reads one game's record stores, `/<app>/rms/*`, from CheerpJ's file system.
 * Read-only. Throws when the data is missing, malformed or over the protocol limits.
 */
async function readSaves(app) {
    const db = await request(indexedDB.open(FS_DATABASE));
    try {
        if (!db.objectStoreNames.contains(FS_STORE)) throw new Error('no file system');
        const store = db.transaction(FS_STORE, 'readonly').objectStore(FS_STORE);
        const prefix = `/${app}/rms/`;
        const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
        const [keys, values] = await Promise.all([request(store.getAllKeys(range)), request(store.getAll(range))]);
        const files = [];
        let total = 0;
        keys.forEach((path, i) => {
            const bytes = values[i]?.contents;
            if (!(bytes instanceof Uint8Array) || !isSavePath(path)) return;
            total += bytes.byteLength;
            if (files.length >= MAX_SAVE_FILES || bytes.byteLength > MAX_SAVE_FILE_BYTES || total > MAX_SAVE_TOTAL_BYTES) {
                throw new Error('over the save limits');
            }
            files.push({ path, data: bytes.slice().buffer });
        });
        return files;
    } finally {
        db.close();
    }
}

async function exportSave(id, app) {
    try {
        const files = await readSaves(app);
        window.parent.postMessage(envelope({ type: 'save-data', id, files }), hostOrigin, files.map((f) => f.data));
    } catch {
        send({ type: 'error', code: 'save-failed' });
    }
}

/**
 * Starts listening for host messages. Does nothing when the page is not embedded.
 * @param {(isDown: boolean, code: string) => void} pressKey - injects a key into the game.
 */
export function startBridge(pressKey) {
    if (window.parent === window) return;

    window.addEventListener('message', (event) => {
        if (!isTrustedSender(event, ALLOWED_HOST_ORIGINS, window.parent)) return;

        const result = parseMessage(event.data, 'host-to-emulator');
        if (!result.ok) {
            if (result.reason === 'unknown-type') {
                hostOrigin = event.origin;
                send({ type: 'error', code: 'unknown-type' });
            }
            return;
        }

        hostOrigin = event.origin;
        const message = result.message;
        if (message.type === 'hello') {
            send({ type: 'ready', capabilities: CAPABILITIES });
            if (startedSize) send({ type: 'started', ...startedSize });
        } else if (message.type === 'export-save') {
            exportSave(message.id, message.app);
        } else if (message.type === 'key') {
            if (Object.hasOwn(codeMap, message.code)) {
                pressKey(message.action === 'down', message.code);
            } else {
                send({ type: 'error', code: 'bad-key' });
            }
        }
    });
}

/** Reports that the game drew its first frame, at its canvas size. */
export function notifyStarted(width, height) {
    startedSize = { width, height };
    if (hostOrigin) send({ type: 'started', ...startedSize });
}
