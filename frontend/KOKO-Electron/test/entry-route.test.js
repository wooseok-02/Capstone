'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { entryDestination, shouldOpenAfterLogin } = require('../lib/entry-route');

const signedIn = { user: { id: 42, provider: 'GOOGLE' }, access: 'short-lived-access-token' };

test('signed out, first-time, and restored-without-user states go to login', () => {
  assert.equal(entryDestination(null), 'auth');
  assert.equal(entryDestination({ user: null, access: null }), 'auth');
  assert.equal(entryDestination({ user: null, access: null, phase: 'restoring' }), 'auth');
});

test('remembered UI history does not permit workspace access', () => {
  assert.equal(entryDestination({ hasAuthenticatedBefore: true, user: null, access: null }), 'auth');
});

test('both actual user and active access token are needed for workspace', () => {
  assert.equal(entryDestination({ user: signedIn.user, access: null }), 'auth');
  assert.equal(entryDestination({ user: null, access: signedIn.access }), 'auth');
  assert.equal(entryDestination(signedIn), 'workspace');
});

test('fresh successful OAuth opens workspace immediately', () => {
  assert.equal(shouldOpenAfterLogin({ phase: 'authenticated', interactive: true, session: signedIn }), true);
});

test('automatic session restoration does not pop up workspace', () => {
  assert.equal(shouldOpenAfterLogin({ phase: 'authenticated', interactive: false, session: signedIn }), false);
  assert.equal(entryDestination(signedIn), 'workspace'); // click after restore
});

test('failed/cancelled/no-token login never opens workspace', () => {
  for (const phase of ['error', 'cancelled', 'waiting', 'restoring', 'idle']) {
    assert.equal(shouldOpenAfterLogin({ phase, interactive: true, session: signedIn }), false);
  }
  assert.equal(shouldOpenAfterLogin({ phase: 'authenticated', interactive: true, session: { user: signedIn.user } }), false);
});

test('logout returns routing to login', () => {
  assert.equal(entryDestination(signedIn), 'workspace');
  assert.equal(entryDestination({ user: null, access: null }), 'auth');
});
