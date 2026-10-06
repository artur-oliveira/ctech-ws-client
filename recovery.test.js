import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create, act} from 'react-test-renderer';
import {useWebSocket} from './dist/useWebSocket.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Socket {
  static CONNECTING=0; static OPEN=1; static CLOSED=3; static instances=[];
  readyState=0; sent=[];
  constructor(){Socket.instances.push(this)}
  send(value){this.sent.push(value)}
  open(){this.readyState=1;this.onopen?.()}
  close(){this.readyState=3;this.onclose?.()}
  message(value){this.onmessage?.({data:value})}
}
async function harness(t, options={}){
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const old=globalThis.WebSocket;globalThis.WebSocket=Socket;Socket.instances=[];
 let result;
 function Harness(){result=useWebSocket({url:'ws://test',onMessage:()=>{},...options});return null}
 let root;await act(async()=>{root=create(React.createElement(Harness))});
 t.after(async()=>{await act(async()=>root.unmount());globalThis.WebSocket=old;t.mock.timers.reset()});
 return {result:()=>result,root};
}
test('continuous recovery survives more than ten disconnects and cancels on unmount',async t=>{
 const h=await harness(t,{reconnectForever:true,reconnectJitter:true});
 for(let i=0;i<13;i++){await act(async()=>Socket.instances.at(-1).close());await act(async()=>t.mock.timers.tick(30000))}
 assert.equal(Socket.instances.length,14);assert.ok(h.result().attempt>10);
 await act(async()=>h.root.unmount());const count=Socket.instances.length;t.mock.timers.tick(60000);assert.equal(Socket.instances.length,count);
});
test('legacy reconnect cap stays unchanged',async t=>{
 await harness(t);for(let i=0;i<12;i++){await act(async()=>Socket.instances.at(-1).close());await act(async()=>t.mock.timers.tick(30000))}assert.equal(Socket.instances.length,11);
});
test('stuck handshakes time out, heartbeat pong keeps session, missed pong reconnects',async t=>{
 await harness(t,{connectTimeoutMs:10000,reconnectForever:true});
 await act(async()=>t.mock.timers.tick(10000));assert.equal(Socket.instances[0].readyState,3);
 await act(async()=>t.mock.timers.tick(1000));const sock=Socket.instances.at(-1);await act(async()=>sock.open());
 await act(async()=>t.mock.timers.tick(20000));assert.equal(JSON.parse(sock.sent.at(-1)).type,'ping');
 await act(async()=>sock.message(JSON.stringify({type:'pong'})));await act(async()=>t.mock.timers.tick(10000));assert.equal(sock.readyState,1);
 await act(async()=>t.mock.timers.tick(10000));await act(async()=>t.mock.timers.tick(10000));assert.equal(sock.readyState,3);
});
test('token refresh replaces socket and stale close cannot disturb new connection',async t=>{
 let refresh;const h=await harness(t,{authToken:'first',subscribeToken:cb=>{refresh=cb;return()=>{};}});
 const old=Socket.instances.at(-1);await act(async()=>old.open());await act(async()=>refresh('second'));const next=Socket.instances.at(-1);await act(async()=>next.open());assert.equal(JSON.parse(next.sent[0]).token,'second');await act(async()=>old.close());assert.equal(h.result().status,'connected');
});
