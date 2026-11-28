'use strict';

// Keep routing decisions in the trusted Electron main process.
// A UI-only "logged in before" flag must never grant access to the workspace.
function entryDestination(session) {
  return session?.user && typeof session.access === 'string' && session.access.length > 0
    ? 'workspace'
    : 'auth';
}

// Only a fresh, user-initiated OAuth completion opens a window automatically.
// A successful silent refresh/restore should wait for a pet click.
function shouldOpenAfterLogin({ phase, interactive, session }) {
  return phase === 'authenticated' && Boolean(interactive) && entryDestination(session) === 'workspace';
}

module.exports = { entryDestination, shouldOpenAfterLogin };
