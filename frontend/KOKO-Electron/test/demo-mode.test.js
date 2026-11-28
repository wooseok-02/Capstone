'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { demoEnabled, petDestination, workspaceConnection } = require('../lib/demo-mode');
const signedIn = {user:{id:'test',provider:'GOOGLE'},access:'real-access-token'};

test('dev demo mode requires explicit CLI argument', () => {
  assert.equal(demoEnabled({isPackaged:false,argv:['electron','.','--koko-ui-demo']}),true);
  assert.equal(demoEnabled({isPackaged:false,argv:['electron','.']}),false);
});
test('packaged application cannot enable demo mode', () => {
  assert.equal(demoEnabled({isPackaged:true,argv:['koko.exe','--koko-ui-demo']}),false);
});
test('demo pet entry opens workspace without OAuth', () => {
  assert.equal(petDestination({demoMode:true,session:null}),'workspace');
});
test('normal pet entry still requires OAuth session', () => {
  assert.equal(petDestination({demoMode:false,session:null}),'auth');
  assert.equal(petDestination({demoMode:false,session:{user:{id:1},access:''}}),'auth');
  assert.equal(petDestination({demoMode:false,session:signedIn}),'workspace');
});
test('demo always reports disconnected even with configured API and stored account', () => {
  assert.deepEqual(workspaceConnection({demoMode:true,session:signedIn,apiUrl:'https://example.test'}),{connected:false,loggedIn:false,serverConfigured:false,demoMode:true});
});
test('normal mode preserves API connection state', () => {
  assert.equal(workspaceConnection({demoMode:false,session:signedIn,apiUrl:'https://example.test'}).connected,true);
  assert.equal(workspaceConnection({demoMode:false,session:signedIn,apiUrl:''}).connected,false);
});
