/**
 * DevTools client for Ulanzi Studio (start it with tools/studio-debug.cmd).
 *
 * PowerShell websockets proved fragile and twice hung for minutes; this uses the
 * bundled Node with --experimental-websocket instead, which Node 20 needs to
 * expose a global WebSocket.
 *
 *   node --experimental-websocket cdp.js list
 *   node --experimental-websocket cdp.js eval  <title> "<expression>"
 *   node --experimental-websocket cdp.js watch <title> [seconds]
 *   node --experimental-websocket cdp.js click <title> "<css selector>"
 *   node --experimental-websocket cdp.js logs  <title> [seconds]
 */
'use strict';

const HOST = '127.0.0.1:9292';
const TIMEOUT_MS = 8000;

function targets() {
  return fetch('http://' + HOST + '/json')
    .then((response) => response.json())
    .catch(() => {
      throw new Error('No DevTools on ' + HOST + ' — start Studio via tools/studio-debug.cmd');
    });
}

function pick(list, needle) {
  if (!needle) return list[0];
  const wanted = needle.toLowerCase();
  return (
    list.find((page) => (page.title || '').toLowerCase().includes(wanted)) ||
    list.find((page) => (page.url || '').toLowerCase().includes(wanted))
  );
}

/** One session, auto-incrementing ids, resolved by matching reply id. */
function connect(target) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    const listeners = [];
    let nextId = 1;

    const guard = setTimeout(() => reject(new Error('connect timed out')), TIMEOUT_MS);

    socket.addEventListener('open', () => {
      clearTimeout(guard);
      resolve({
        send(method, params) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params: params || {} }));
          return new Promise((ok, fail) => {
            const timer = setTimeout(() => fail(new Error(method + ' timed out')), TIMEOUT_MS);
            pending.set(id, { ok, fail, timer });
          });
        },
        on(handler) {
          listeners.push(handler);
        },
        close() {
          try {
            socket.close();
          } catch (err) {
            /* already gone */
          }
        }
      });
    });

    socket.addEventListener('error', () => {
      clearTimeout(guard);
      reject(new Error('websocket error on ' + target.title));
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.fail(new Error(message.error.message));
        else entry.ok(message.result);
        return;
      }
      for (const handler of listeners) handler(message);
    });
  });
}

/** Console/exception plumbing, shared by watch, logs and click. */
function stream(session) {
  session.on((message) => {
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params.args || [])
        .map((arg) => (arg.value !== undefined ? arg.value : arg.description || arg.type))
        .join(' ');
      console.log('  [' + message.params.type + '] ' + text);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails || {};
      const thrown = detail.exception || {};
      console.log('  [EXCEPTION] ' + (thrown.description || detail.text));
      const frames = (detail.stackTrace && detail.stackTrace.callFrames) || [];
      for (const frame of frames.slice(0, 6)) {
        const file = String(frame.url).split('/').pop();
        console.log('      at ' + (frame.functionName || '(anon)') + ' ' + file + ':' + (frame.lineNumber + 1));
      }
    }
    if (message.method === 'Log.entryAdded') {
      const entry = message.params.entry;
      if (entry.level === 'error' || entry.level === 'warning') {
        console.log('  [log/' + entry.level + '] ' + entry.text + ' ' + (entry.url || ''));
      }
    }
  });
  return Promise.all([
    session.send('Runtime.enable'),
    session.send('Log.enable'),
    session.send('Page.enable')
  ]);
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression: expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    const thrown = result.exceptionDetails.exception || {};
    return 'EXCEPTION: ' + (thrown.description || result.exceptionDetails.text);
  }
  const value = result.result && result.result.value;
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function main() {
  const [command, needle, argument] = process.argv.slice(2);
  const list = await targets();

  if (!command || command === 'list') {
    for (const page of list) {
      console.log('- ' + (page.title || '(untitled)') + '  [' + page.type + ']');
      console.log('    ' + String(page.url).slice(0, 150));
    }
    return;
  }

  const target = pick(list, needle);
  if (!target) throw new Error('No page matching "' + needle + '"');
  console.log('# ' + target.title);
  const session = await connect(target);

  if (command === 'eval') {
    console.log(await evaluate(session, argument));
  } else if (command === 'watch' || command === 'logs') {
    await stream(session);
    const seconds = Number(argument) || 10;
    console.log('# listening ' + seconds + 's — interact with Studio now');
    await sleep(seconds * 1000);
  } else if (command === 'run') {
    await stream(session);
    console.log(await evaluate(session, argument));
    await sleep(3000);
  } else if (command === 'click') {
    await stream(session);
    console.log(
      await evaluate(
        session,
        '(function(){var n=document.querySelector(' +
          JSON.stringify(argument) +
          ');if(!n)return "NOT FOUND: ' +
          argument +
          '";n.click();return "clicked "+(n.id||n.tagName);})()'
      )
    );
    await sleep(1500);
  } else {
    throw new Error('Unknown command: ' + command);
  }

  session.close();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
);
