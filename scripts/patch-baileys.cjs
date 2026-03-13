const fs = require('fs');
const path = require('path');

const SOCKET_FILE = path.join(__dirname, '..', 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Socket', 'socket.js');
const CHATS_FILE = path.join(__dirname, '..', 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Socket', 'chats.js');
const MESSAGES_RECV_FILE = path.join(__dirname, '..', 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Socket', 'messages-recv.js');

function patchSocket() {
    if (!fs.existsSync(SOCKET_FILE)) { console.log('[patch-baileys] socket.js not found, skipping'); return; }
    let code = fs.readFileSync(SOCKET_FILE, 'utf-8');

    if (code.includes('// [PATCHED] event buffer disabled')) {
        console.log('[patch-baileys] socket.js already patched');
        return;
    }

    let patched = false;

    const bufferBlock = /if \(creds\.me\?\.id\) \{\s*\/\/ start buffering important events\s*\/\/ if we're logged in\s*ev\.buffer\(\);\s*didStartBuffer = true;\s*\}/;
    if (bufferBlock.test(code)) {
        code = code.replace(bufferBlock, '// [PATCHED] event buffer disabled\n            didStartBuffer = false;');
        patched = true;
    }

    const offlineFlush = /if \(didStartBuffer\) \{\s*ev\.flush\(\);\s*logger\.trace\('flushed events for initial buffer'\);\s*\}/;
    if (offlineFlush.test(code)) {
        code = code.replace(offlineFlush, '// [PATCHED] no buffer to flush');
        patched = true;
    }

    code = code.replace(
        /if \(!offlineHandled && didStartBuffer\) \{/,
        'if (!offlineHandled) {'
    );

    code = code.replace(
        "logger.warn('CB:ib,,offline never fired, force-flushing buffer and signaling readiness');",
        "logger.warn('CB:ib,,offline never fired, signaling readiness');"
    );

    const forceFlushLine = /offlineHandled = true;\s*ev\.flush\(\);\s*ev\.emit\('connection\.update'/;
    if (forceFlushLine.test(code)) {
        code = code.replace(forceFlushLine, "offlineHandled = true;\n            ev.emit('connection.update'");
        patched = true;
    }

    if (patched) {
        fs.writeFileSync(SOCKET_FILE, code, 'utf-8');
        console.log('[patch-baileys] socket.js patched - event buffering disabled');
    } else {
        console.log('[patch-baileys] socket.js - no matching patterns found');
    }
}

function patchChats() {
    if (!fs.existsSync(CHATS_FILE)) { console.log('[patch-baileys] chats.js not found, skipping'); return; }
    let code = fs.readFileSync(CHATS_FILE, 'utf-8');

    if (code.includes('Skipping AwaitingInitialSync')) {
        console.log('[patch-baileys] chats.js already patched');
        return;
    }

    const syncBlock = /syncState = SyncState\.AwaitingInitialSync;\s*logger\.info\('Connection is now AwaitingInitialSync, buffering events'\);\s*ev\.buffer\(\);[\s\S]*?(?=\s*\}\);)/;

    if (syncBlock.test(code)) {
        code = code.replace(syncBlock,
            "syncState = SyncState.Online;\n        logger.info('Skipping AwaitingInitialSync \\u2014 transitioning directly to Online (no buffering).');\n        try { ev.flush(); } catch(_) {}"
        );
        fs.writeFileSync(CHATS_FILE, code, 'utf-8');
        console.log('[patch-baileys] chats.js patched - AwaitingInitialSync bypassed');
    } else {
        console.log('[patch-baileys] chats.js - no matching patterns found (may already be patched differently)');
    }
}

function patchMessagesRecv() {
    if (!fs.existsSync(MESSAGES_RECV_FILE)) { console.log('[patch-baileys] messages-recv.js not found, skipping'); return; }
    let recvContent = fs.readFileSync(MESSAGES_RECV_FILE, 'utf-8');

    if (!recvContent.includes('// silenced mex newsletter')) {
        recvContent = recvContent.replace(
            "logger.warn({ node }, 'Invalid mex newsletter notification');",
            '// silenced mex newsletter\n            return;'
        );
        recvContent = recvContent.replace(
            "logger.warn({ data }, 'Invalid mex newsletter notification content');",
            '// silenced mex newsletter content\n            return;'
        );
        fs.writeFileSync(MESSAGES_RECV_FILE, recvContent, 'utf-8');
        console.log('[patch-baileys] Silenced mex newsletter notification warnings');
    } else {
        console.log('[patch-baileys] Newsletter warnings already silenced');
    }
}

function patchSessionCipher() {
    const SESSION_CIPHER_FILE = path.join(__dirname, '..', 'node_modules', '@whiskeysockets', 'baileys', 'node_modules', 'libsignal', 'src', 'session_cipher.js');
    if (!fs.existsSync(SESSION_CIPHER_FILE)) { console.log('[patch-baileys] session_cipher.js not found, skipping'); return; }
    let cipherContent = fs.readFileSync(SESSION_CIPHER_FILE, 'utf-8');

    if (!cipherContent.includes('// silenced decrypt errors')) {
        cipherContent = cipherContent.replace(
            'console.error("Failed to decrypt message with any known session...");',
            '// silenced decrypt errors'
        );
        cipherContent = cipherContent.replace(
            'console.error("Session error:" + e, e.stack);',
            '// silenced session error log'
        );
        fs.writeFileSync(SESSION_CIPHER_FILE, cipherContent, 'utf-8');
        console.log('[patch-baileys] Silenced libsignal decrypt error console logs');
    } else {
        console.log('[patch-baileys] libsignal decrypt errors already silenced');
    }
}

function patchSendDiagnostics() {
    if (!fs.existsSync(SOCKET_FILE)) return;
    let code = fs.readFileSync(SOCKET_FILE, 'utf-8');

    if (code.includes('// [PATCHED] send diagnostics')) {
        console.log('[patch-baileys] send diagnostics already patched');
        return;
    }

    // Patch sendRawMessage to log ws.isOpen state and any send errors
    const original = `    const sendRawMessage = async (data) => {
        if (!ws.isOpen) {
            throw new boom_1.Boom('Connection Closed', { statusCode: Types_1.DisconnectReason.connectionClosed });
        }
        const bytes = noise.encodeFrame(data);
        await (0, Utils_1.promiseTimeout)(connectTimeoutMs, async (resolve, reject) => {
            try {
                await sendPromise.call(ws, bytes);
                resolve();
            }
            catch (error) {
                reject(error);
            }
        });
    };`;

    const patched = `    // [PATCHED] send diagnostics
    const sendRawMessage = async (data) => {
        if (!ws.isOpen) {
            console.error('[TRUTH-MD] sendRawMessage BLOCKED: ws.isOpen=false (connection closed), bytes:', data && data.length);
            throw new boom_1.Boom('Connection Closed', { statusCode: Types_1.DisconnectReason.connectionClosed });
        }
        const bytes = noise.encodeFrame(data);
        await (0, Utils_1.promiseTimeout)(connectTimeoutMs, async (resolve, reject) => {
            try {
                await sendPromise.call(ws, bytes);
                resolve();
            }
            catch (error) {
                console.error('[TRUTH-MD] sendRawMessage FAILED:', error && error.message);
                reject(error);
            }
        });
    };`;

    if (code.includes(original)) {
        code = code.replace(original, patched);
        fs.writeFileSync(SOCKET_FILE, code, 'utf-8');
        console.log('[patch-baileys] send diagnostics patched into socket.js');
    } else {
        console.log('[patch-baileys] send diagnostics: pattern not matched in socket.js');
    }
}

const MESSAGES_SEND_FILE = path.join(__dirname, '..', 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Socket', 'messages-send.js');

function patchRelaySendDiagnostics() {
    if (!fs.existsSync(MESSAGES_SEND_FILE)) { console.log('[patch-baileys] messages-send.js not found'); return; }
    let code = fs.readFileSync(MESSAGES_SEND_FILE, 'utf-8');

    if (code.includes('// [PATCHED] relay diagnostics')) {
        console.log('[patch-baileys] relay diagnostics already patched');
        return;
    }

    // Wrap sendMessage to log call + errors
    const original = `        sendMessage: async (jid, content, options = {}) => {`;
    const patched = `        // [PATCHED] relay diagnostics
        sendMessage: async (jid, content, options = {}) => {
            console.log('[TRUTH-MD] sendMessage called → jid:', jid, 'type:', content && Object.keys(content)[0]);`;

    if (code.includes(original)) {
        code = code.replace(original, patched);
        fs.writeFileSync(MESSAGES_SEND_FILE, code, 'utf-8');
        console.log('[patch-baileys] relay diagnostics patched into messages-send.js');
    } else {
        console.log('[patch-baileys] relay diagnostics: sendMessage pattern not matched');
    }
}

function findRelayFile(filename) {
    const xsqlite3Dir = path.join(__dirname, '..', 'node_modules', 'xsqlite3');
    if (!fs.existsSync(xsqlite3Dir)) return null;
    function walk(dir, depth) {
        if (depth > 60) return null;
        try {
            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
                const full = path.join(dir, entry);
                if (entry === filename) return full;
                try {
                    if (fs.statSync(full).isDirectory()) {
                        const found = walk(full, depth + 1);
                        if (found) return found;
                    }
                } catch (_) {}
            }
        } catch (_) {}
        return null;
    }
    return walk(xsqlite3Dir, 0);
}

function patchCommandSpeed() {
    const mainFile = findRelayFile('main.js');
    if (!mainFile) { console.log('[patch-baileys] main.js not found in relay'); return; }

    let code = fs.readFileSync(mainFile, 'utf-8');

    if (code.includes('// [PATCHED] pre-command delay removed')) {
        console.log('[patch-baileys] main.js command speed already patched');
        return;
    }

    let patched = false;

    // Remove the 1000-1800ms pre-command typing wait
    const preDelay = `        // For DMs: show typing indicator BEFORE command executes so it feels natural
        if (!isGroup && isAutotypingEnabled()) {
            try {
                await sock.sendPresenceUpdate('composing', chatId);
                await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 800));
            } catch (_) {}
        }`;
    const preDelayPatched = `        // [PATCHED] pre-command delay removed — respond instantly
        if (!isGroup && isAutotypingEnabled()) {
            try { await sock.sendPresenceUpdate('composing', chatId); } catch (_) {}
        }`;
    if (code.includes(preDelay)) {
        code = code.replace(preDelay, preDelayPatched);
        patched = true;
    }

    // Remove post-command typing/recording status calls
    const postDelay = `            // Command was executed, now show typing/recording status after command execution
            await showTypingAfterCommand(sock, chatId);
            showRecordingAfterCommand(sock, chatId).catch(() => {});`;
    const postDelayPatched = `            // [PATCHED] post-command typing/recording removed for speed`;
    if (code.includes(postDelay)) {
        code = code.replace(postDelay, postDelayPatched);
        patched = true;
    }

    if (patched) {
        fs.writeFileSync(mainFile, code, 'utf-8');
        console.log('[patch-baileys] main.js patched - command response delays removed');
    } else {
        console.log('[patch-baileys] main.js - delay patterns not matched');
    }
}

function patchOwnerDisplay() {
    const setownerFile = findRelayFile('setowner.js');
    const helpFile = findRelayFile('help.js');

    // Patch setowner.js: change default name from 'Not Set!' to ''
    if (setownerFile) {
        let code = fs.readFileSync(setownerFile, 'utf-8');
        if (code.includes('// [PATCHED] owner default empty')) {
            console.log('[patch-baileys] setowner.js already patched');
        } else {
            const orig = `const DEFAULT_OWNER_NAME = 'Not Set!';`;
            const patched = `// [PATCHED] owner default empty\nconst DEFAULT_OWNER_NAME = 'Not Set';`;
            if (code.includes(orig)) {
                code = code.replace(orig, patched);
                fs.writeFileSync(setownerFile, code, 'utf-8');
                console.log('[patch-baileys] setowner.js patched - owner default set to empty');
            } else {
                console.log('[patch-baileys] setowner.js - DEFAULT_OWNER_NAME pattern not found');
            }
        }
    } else {
        console.log('[patch-baileys] setowner.js not found in relay');
    }

    // Patch help.js: skip Owner line when name is empty
    if (helpFile) {
        let code = fs.readFileSync(helpFile, 'utf-8');
        if (code.includes('// [PATCHED] owner line conditional')) {
            console.log('[patch-baileys] help.js owner line already patched');
        } else {
            const orig = `    menu += \`◆ *Owner:* \${newOwner}\\n\`;`;
            const patched = `    // [PATCHED] owner line conditional\n    if (newOwner) menu += \`◆ *Owner:* \${newOwner}\\n\`;`;
            if (code.includes(orig)) {
                code = code.replace(orig, patched);
                fs.writeFileSync(helpFile, code, 'utf-8');
                console.log('[patch-baileys] help.js patched - owner line hidden when empty');
            } else {
                console.log('[patch-baileys] help.js - owner menu line pattern not found');
            }
        }
    } else {
        console.log('[patch-baileys] help.js not found in relay');
    }
}

function patchOwnerAccess() {
    const libIndexFile = findRelayFile('index.js');
    // We need lib/index.js specifically (has isSudo), not the root index.js
    // findRelayFile returns the FIRST match — check if it has isSudo
    let libFile = null;
    const xsqlite3Dir = path.join(__dirname, '..', 'node_modules', 'xsqlite3');
    function findLibIndex(dir, depth) {
        if (depth > 60) return null;
        try {
            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
                const full = path.join(dir, entry);
                if (entry === 'index.js') {
                    const content = fs.readFileSync(full, 'utf-8');
                    if (content.includes('async function isSudo')) return full;
                }
                try {
                    if (fs.statSync(full).isDirectory()) {
                        const found = findLibIndex(full, depth + 1);
                        if (found) return found;
                    }
                } catch (_) {}
            }
        } catch (_) {}
        return null;
    }
    libFile = findLibIndex(xsqlite3Dir, 0);

    if (!libFile) { console.log('[patch-baileys] lib/index.js (isSudo) not found'); return; }

    let code = fs.readFileSync(libFile, 'utf-8');
    if (code.includes('// [PATCHED] owner access - connected number')) {
        console.log('[patch-baileys] isSudo already patched for owner access');
        return;
    }

    // Add connected socket's phone number + OWNER_NUMBER to sudo check
    const orig = `    for (const num of ownerNumbers) {
        if (!num) continue;
        if (senderId === num + '@s.whatsapp.net' || senderNum === num) return true;
    }`;
    const patched = `    // [PATCHED] owner access - connected number always treated as owner
    try {
        const connId = global.currentSocket?.user?.id;
        if (connId) {
            const connNum = connId.split(':')[0].split('@')[0];
            if (connNum && !ownerNumbers.includes(connNum)) ownerNumbers.push(connNum);
        }
    } catch (_) {}
    for (const num of ownerNumbers) {
        if (!num) continue;
        if (senderId === num + '@s.whatsapp.net' || senderNum === num) return true;
    }`;

    if (code.includes(orig)) {
        code = code.replace(orig, patched);
        fs.writeFileSync(libFile, code, 'utf-8');
        console.log('[patch-baileys] isSudo patched - connected number always has owner access');
    } else {
        console.log('[patch-baileys] isSudo - owner access pattern not matched');
    }
}

function patchConnectionMessage() {
    const relayIndexFile = (() => {
        const xsqlite3Dir = path.join(__dirname, '..', 'node_modules', 'xsqlite3');
        function findRootIndex(dir, depth) {
            if (depth > 60) return null;
            try {
                const entries = fs.readdirSync(dir);
                for (const entry of entries) {
                    const full = path.join(dir, entry);
                    if (entry === 'index.js') {
                        const content = fs.readFileSync(full, 'utf-8');
                        if (content.includes('connectionMessageSent') && content.includes('sendWelcomeMessage')) return full;
                    }
                    try {
                        if (fs.statSync(full).isDirectory()) {
                            const found = findRootIndex(full, depth + 1);
                            if (found) return found;
                        }
                    } catch (_) {}
                }
            } catch (_) {}
            return null;
        }
        return findRootIndex(xsqlite3Dir, 0);
    })();

    if (!relayIndexFile) { console.log('[patch-baileys] relay index.js (connectionMessageSent) not found'); return; }

    let code = fs.readFileSync(relayIndexFile, 'utf-8');
    if (code.includes('// [PATCHED] always send connection msg to owner')) {
        console.log('[patch-baileys] connection message already patched');
        return;
    }

    // Always send to OWNER_NUMBER — remove the !== pNumber guard
    const orig = `                const envOwner = (process.env.OWNER_NUMBER || '').trim();
                if (envOwner && envOwner + '@s.whatsapp.net' !== pNumber) {
                    await XeonBotInc.sendMessage(envOwner + '@s.whatsapp.net', { text: connectionMsg }).catch(() => {});
                }`;
    const patched = `                // [PATCHED] always send connection msg to owner
                const envOwner = (process.env.OWNER_NUMBER || '').trim();
                if (envOwner) {
                    await XeonBotInc.sendMessage(envOwner + '@s.whatsapp.net', { text: connectionMsg }).catch(e => console.error('[TRUTH-MD] Connection msg to owner failed:', e.message));
                }`;

    if (code.includes(orig)) {
        code = code.replace(orig, patched);
        fs.writeFileSync(relayIndexFile, code, 'utf-8');
        console.log('[patch-baileys] connection message patched - always sends to OWNER_NUMBER');
    } else {
        console.log('[patch-baileys] connection message - pattern not matched');
    }
}

console.log('[patch-baileys] Applying Baileys patches...');
patchSocket();
patchChats();
patchMessagesRecv();
patchSessionCipher();
patchSendDiagnostics();
patchRelaySendDiagnostics();
patchCommandSpeed();
patchOwnerDisplay();
patchOwnerAccess();
patchConnectionMessage();
console.log('[patch-baileys] Done.');
