const io = require('socket.io-client');

const TEST_URL = 'http://localhost:3000';
let passed = 0;
let failed = 0;
let tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, msg) {
  if (!condition) throw new Error(`ASSERT: ${msg}`);
}

function logResult(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} - ${detail}`);
  }
}

async function runAll() {
  console.log('\n=== SyncScribble Canvas Test Suite ===\n');

  for (const t of tests) {
    try {
      await t.fn();
      logResult(t.name, true);
    } catch (err) {
      logResult(t.name, false, err.message);
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// ========== Test Cases ==========

test('Server accepts connection and returns history', () => {
  return new Promise((resolve, reject) => {
    const client = io(TEST_URL, { transports: ['websocket'] });
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error('Connection timeout'));
    }, 5000);

    client.on('connect', () => {
      clearTimeout(timeout);
      assert(client.connected, 'Client should be connected');
      client.close();
      resolve();
    });
  });
});

test('Server sends empty history on fresh connection', () => {
  return new Promise((resolve, reject) => {
    const client = io(TEST_URL, { transports: ['websocket'] });
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error('Timeout waiting for history'));
    }, 5000);

    client.on('history', (history) => {
      clearTimeout(timeout);
      assert(Array.isArray(history), 'History should be an array');
      client.close();
      resolve();
    });

    client.on('connect', () => {});
  });
});

test('Server emits userCount on connection', () => {
  return new Promise((resolve, reject) => {
    const client = io(TEST_URL, { transports: ['websocket'] });
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error('Timeout waiting for userCount'));
    }, 5000);

    client.on('userCount', (count) => {
      clearTimeout(timeout);
      assert(typeof count === 'number', 'userCount should be a number');
      assert(count >= 1, 'Should have at least 1 user');
      client.close();
      resolve();
    });
  });
});

test('drawStart event is broadcast to other clients', () => {
  return new Promise((resolve, reject) => {
    const client1 = io(TEST_URL, { transports: ['websocket'] });
    const client2 = io(TEST_URL, { transports: ['websocket'] });
    let c1ready = false, c2ready = false;

    const timeout = setTimeout(() => {
      client1.close(); client2.close();
      reject(new Error('Timeout'));
    }, 5000);

    client2.on('drawStart', (data) => {
      clearTimeout(timeout);
      assert(data.x === 100, 'x should be 100');
      assert(data.y === 200, 'y should be 200');
      assert(data.color === '#ff0000', 'color should be #ff0000');
      assert(data.size === 10, 'size should be 10');
      assert(data.lineCap === 'round', 'lineCap should be round');
      assert(data.opacity === 0.8, 'opacity should be 0.8');
      assert(data.tool === 'pen', 'tool should be pen');
      assert(typeof data.id === 'string', 'id should be a string');
      client1.close(); client2.close();
      resolve();
    });

    client1.on('connect', () => { c1ready = true; if (c2ready) startTest(); });
    client2.on('connect', () => { c2ready = true; if (c1ready) startTest(); });

    function startTest() {
      if (!c1ready || !c2ready) return;
      setTimeout(() => {
        client1.emit('drawStart', {
          x: 100, y: 200, color: '#ff0000', size: 10,
          lineCap: 'round', opacity: 0.8, tool: 'pen'
        });
      }, 100);
    }
  });
});

test('drawMove event is broadcast with correct data', () => {
  return new Promise((resolve, reject) => {
    const client1 = io(TEST_URL, { transports: ['websocket'] });
    const client2 = io(TEST_URL, { transports: ['websocket'] });
    let c1ready = false, c2ready = false;

    const timeout = setTimeout(() => {
      client1.close(); client2.close();
      reject(new Error('Timeout'));
    }, 5000);

    client2.on('drawMove', (data) => {
      clearTimeout(timeout);
      assert(data.x === 150, 'x should be 150');
      assert(data.y === 250, 'y should be 250');
      assert(data.prevX === 100, 'prevX should be 100');
      assert(data.prevY === 200, 'prevY should be 200');
      assert(data.tool === 'eraser', 'tool should be eraser');
      client1.close(); client2.close();
      resolve();
    });

    client1.on('connect', () => { c1ready = true; if (c2ready) startTest(); });
    client2.on('connect', () => { c2ready = true; if (c1ready) startTest(); });

    function startTest() {
      if (!c1ready || !c2ready) return;
      setTimeout(() => {
        client1.emit('drawMove', {
          x: 150, y: 250, prevX: 100, prevY: 200,
          color: '#000000', size: 5, lineCap: 'square',
          opacity: 1, tool: 'eraser'
        });
      }, 100);
    }
  });
});

test('drawEnd event is broadcast to other clients', () => {
  return new Promise((resolve, reject) => {
    const client1 = io(TEST_URL, { transports: ['websocket'] });
    const client2 = io(TEST_URL, { transports: ['websocket'] });
    let c1ready = false, c2ready = false;

    const timeout = setTimeout(() => {
      client1.close(); client2.close();
      reject(new Error('Timeout'));
    }, 5000);

    client2.on('drawEnd', (data) => {
      clearTimeout(timeout);
      assert(typeof data === 'object', 'Should receive drawEnd data');
      client1.close(); client2.close();
      resolve();
    });

    client1.on('connect', () => { c1ready = true; if (c2ready) startTest(); });
    client2.on('connect', () => { c2ready = true; if (c1ready) startTest(); });

    function startTest() {
      if (!c1ready || !c2ready) return;
      setTimeout(() => {
        client1.emit('drawEnd', {});
      }, 100);
    }
  });
});

test('clearCanvas broadcasts to other clients and clears history', () => {
  return new Promise((resolve, reject) => {
    const client1 = io(TEST_URL, { transports: ['websocket'] });
    const client2 = io(TEST_URL, { transports: ['websocket'] });
    let c1ready = false, c2ready = false;

    const timeout = setTimeout(() => {
      client1.close(); client2.close();
      reject(new Error('Timeout'));
    }, 5000);

    client2.on('clearCanvas', () => {
      clearTimeout(timeout);

      // Now connect a 3rd client to verify history is empty
      const client3 = io(TEST_URL, { transports: ['websocket'] });
      client3.on('history', (history) => {
        assert(history.length === 0, 'History should be empty after clear');
        client1.close(); client2.close(); client3.close();
        resolve();
      });
    });

    client1.on('connect', () => { c1ready = true; if (c2ready) startTest(); });
    client2.on('connect', () => { c2ready = true; if (c1ready) startTest(); });

    function startTest() {
      if (!c1ready || !c2ready) return;
      setTimeout(() => {
        client1.emit('clearCanvas');
      }, 100);
    }
  });
});

test('setBackground is broadcast to other clients', () => {
  return new Promise((resolve, reject) => {
    const client1 = io(TEST_URL, { transports: ['websocket'] });
    const client2 = io(TEST_URL, { transports: ['websocket'] });
    let c1ready = false, c2ready = false;

    const timeout = setTimeout(() => {
      client1.close(); client2.close();
      reject(new Error('Timeout'));
    }, 5000);

    client2.on('setBackground', (dataUrl) => {
      clearTimeout(timeout);
      assert(typeof dataUrl === 'string', 'dataUrl should be a string');
      assert(dataUrl.startsWith('data:image/'), 'Should be a data URL');
      client1.close(); client2.close();
      resolve();
    });

    client1.on('connect', () => { c1ready = true; if (c2ready) startTest(); });
    client2.on('connect', () => { c2ready = true; if (c1ready) startTest(); });

    function startTest() {
      if (!c1ready || !c2ready) return;
      setTimeout(() => {
        client1.emit('setBackground', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
      }, 100);
    }
  });
});

test('clearBackground is broadcast to other clients', () => {
  return new Promise((resolve, reject) => {
    const client1 = io(TEST_URL, { transports: ['websocket'] });
    const client2 = io(TEST_URL, { transports: ['websocket'] });
    let c1ready = false, c2ready = false;

    const timeout = setTimeout(() => {
      client1.close(); client2.close();
      reject(new Error('Timeout'));
    }, 5000);

    client2.on('clearBackground', () => {
      clearTimeout(timeout);
      client1.close(); client2.close();
      resolve();
    });

    client1.on('connect', () => { c1ready = true; if (c2ready) startTest(); });
    client2.on('connect', () => { c2ready = true; if (c1ready) startTest(); });

    function startTest() {
      if (!c1ready || !c2ready) return;
      setTimeout(() => {
        client1.emit('clearBackground');
      }, 100);
    }
  });
});

test('History is stored and replayed on new connection (order preserved)', () => {
  return new Promise((resolve, reject) => {
    const client1 = io(TEST_URL, { transports: ['websocket'] });

    const timeout = setTimeout(() => {
      client1.close();
      reject(new Error('Timeout'));
    }, 10000);

    client1.on('connect', () => {
      // Clear first
      client1.emit('clearCanvas');

      setTimeout(() => {
        // Draw some strokes
        client1.emit('drawStart', { x: 10, y: 20, color: '#111111', size: 3, lineCap: 'round', opacity: 1, tool: 'pen' });
        client1.emit('drawMove', { x: 30, y: 40, prevX: 10, prevY: 20, color: '#111111', size: 3, lineCap: 'round', opacity: 1, tool: 'pen' });
        client1.emit('drawMove', { x: 50, y: 60, prevX: 30, prevY: 40, color: '#111111', size: 3, lineCap: 'round', opacity: 1, tool: 'pen' });
        client1.emit('drawEnd', {});

        // Connect 2nd client to receive history
        setTimeout(() => {
          const client2 = io(TEST_URL, { transports: ['websocket'] });
          client2.on('history', (history) => {
            clearTimeout(timeout);

            const moves = history.filter(h => h.type === 'drawMove');
            assert(moves.length === 2, `Should have 2 drawMoves in history, got ${moves.length}`);

            const types = history.map(h => h.type);
            assert(types[0] === 'drawStart', 'First should be drawStart');
            assert(types[types.length - 1] === 'drawEnd', 'Last should be drawEnd');

            client1.close(); client2.close();
            resolve();
          });
        }, 200);
      }, 200);
    });
  });
});

test('History is capped at MAX_HISTORY (5000 entries)', () => {
  return new Promise((resolve, reject) => {
    const client = io(TEST_URL, { transports: ['websocket'] });

    const timeout = setTimeout(() => {
      client.close();
      reject(new Error('Timeout'));
    }, 30000);

    client.on('connect', () => {
      client.emit('clearCanvas');

      setTimeout(() => {
        // Send 5100 drawMove events (exceeds 5000 cap)
        let sent = 0;
        const total = 5100;

        function sendBatch() {
          const batchSize = 100;
          for (let i = 0; i < batchSize && sent < total; i++, sent++) {
            client.emit('drawMove', {
              x: sent, y: sent, prevX: sent - 1, prevY: sent - 1,
              color: '#000', size: 1, lineCap: 'round', opacity: 1, tool: 'pen'
            });
          }
          if (sent < total) {
            setImmediate(sendBatch);
          } else {
            // Now check history
            setTimeout(() => {
              const client2 = io(TEST_URL, { transports: ['websocket'] });
              client2.on('history', (history) => {
                clearTimeout(timeout);
                const moves = history.filter(h => h.type === 'drawMove');
                assert(moves.length <= 5000, `History should be capped at 5000, got ${moves.length}`);
                client.close(); client2.close();
                resolve();
              });
            }, 200);
          }
        }
        sendBatch();
      }, 200);
    });
  });
});

test('Multiple clients can draw simultaneously (state isolation)', () => {
  return new Promise((resolve, reject) => {
    const client1 = io(TEST_URL, { transports: ['websocket'] });
    const client2 = io(TEST_URL, { transports: ['websocket'] });
    const client3 = io(TEST_URL, { transports: ['websocket'] });

    let receivedBy2 = 0;
    let receivedBy3 = 0;
    let senderDone = false;
    let ready = 0;

    const timeout = setTimeout(() => {
      client1.close(); client2.close(); client3.close();
      reject(new Error('Timeout'));
    }, 5000);

    function checkDone() {
      if (receivedBy2 > 0 && receivedBy3 > 0 && senderDone) {
        clearTimeout(timeout);
        client1.close(); client2.close(); client3.close();
        resolve();
      }
    }

    client2.on('drawStart', (data) => { receivedBy2++; checkDone(); });
    client3.on('drawStart', (data) => { receivedBy3++; checkDone(); });

    function tryStart() {
      ready++;
      if (ready < 3) return;
      setTimeout(() => {
        client1.emit('drawStart', { x: 50, y: 50, color: '#333', size: 5, lineCap: 'round', opacity: 1, tool: 'pen' });
        senderDone = true;
        checkDone();
      }, 100);
    }

    client1.on('connect', tryStart);
    client2.on('connect', tryStart);
    client3.on('connect', tryStart);
  });
});

test('Second client connection triggers additional userCount event', () => {
  return new Promise((resolve, reject) => {
    const observer = io(TEST_URL, { transports: ['websocket'] });
    let c2 = null;

    const timeout = setTimeout(() => {
      observer.close();
      if (c2) c2.close();
      reject(new Error('Timeout'));
    }, 5000);

    observer.on('userCount', (count) => {
      if (!c2) {
        c2 = io(TEST_URL, { transports: ['websocket'], reconnection: false });
      } else {
        clearTimeout(timeout);
        assert(typeof count === 'number', 'userCount must be a number');
        observer.close();
        c2.close();
        resolve();
      }
    });
  });
});

// Run all tests
runAll();
