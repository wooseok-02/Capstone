'use strict';
const { entryDestination } = require('./entry-route');

// Demo can only be entered explicitly from the unpackaged development build.
// Installed/packaged releases cannot enable it through command-line arguments.
const DEMO_FLAG = '--koko-ui-demo';
function demoEnabled({ isPackaged, argv }) {
  return isPackaged === false && Array.isArray(argv) && argv.includes(DEMO_FLAG);
}
function petDestination({ demoMode, session }) {
  return demoMode ? 'workspace' : entryDestination(session);
}
function workspaceConnection({ demoMode, session, apiUrl }) {
  if (demoMode) return { connected: false, loggedIn: false, serverConfigured: false, demoMode: true };
  const loggedIn = Boolean(session?.user);
  return { connected: Boolean(session?.user && session?.access && apiUrl), loggedIn, serverConfigured: Boolean(apiUrl), demoMode: false };
}
module.exports = { DEMO_FLAG, demoEnabled, petDestination, workspaceConnection };
