const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource://gre/modules/AddonManager.jsm');

// Create background part of the extension (window object). The
// background script is loaded separately using the window for its context
// so that it will have access to our CommonJS functionality and
// extension API.
var backgroundWindow = null;
var xulWindow = null;

function createBackground() {
  backgroundWindow = Services.ww.openWindow(
    null, // parent
    'chrome://{{SHORTNAME}}/content/background.xul', // url
    null, // window name
    null, // features
    null  // extra arguments
  );

  xulWindow = backgroundWindow.QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIWebNavigation)
    .QueryInterface(Ci.nsIDocShellTreeItem)
    .treeOwner
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIXULWindow);

  xulWindow.QueryInterface(Ci.nsIBaseWindow).visibility = false;

  // Unregister our hidden window so it doesn't appear in the Window menu.
  backgroundWindow.addEventListener('load', function(event) {
    backgroundWindow.removeEventListener('load', arguments.callee, false);
    Services.appShell.unregisterTopLevelWindow(xulWindow);
  }, false);

  // Tell Gecko that we closed the window already so it doesn't hold Firefox open
  // if all other windows are closed.
  Services.startup.QueryInterface(Ci.nsIObserver).observe(null, 'xul-window-destroyed', null);
}

// Revert all visual additions, unregister all observers and handlers. All this
// is done in the background window handler, so we simply close the window...
//
function releaseBackground() {
  if (xulWindow) {
    // Register the window again so that the window count remains accurate.
    // Otherwise the window mediator will think we have one less window than we really do.
    Services.startup.QueryInterface(Ci.nsIObserver).observe(xulWindow, 'xul-window-registered', null);
  }

  if (backgroundWindow) {
    backgroundWindow.close();
    backgroundWindow = null;
  }
}

function setResourceSubstitution(addon) {
  // Create a resource:// URL substitution so that we can access files
  // in the extension directly.
  var resourceProtocol = Services.io.getProtocolHandler('resource').
    QueryInterface(Ci.nsIResProtocolHandler);
  resourceProtocol.setSubstitution('trusted-ads', addon.getResourceURI('/'));
}

function loadConfig(addon) {
  // Load the manifest
  Cu.import('resource://{{SHORTNAME}}/modules/Require.jsm');
  var baseURI = Services.io.newURI('resource://{{SHORTNAME}}/modules/', '', null);
  var require = Require.createRequireForWindow(this, baseURI);

  var contentScripts = require('./config').contentScripts;
  var readStringFromUrl = require('./utils').readStringFromUrl;

  if (addon.hasResource('manifest.json')) {
    var manifestUrl = addon.getResourceURI('manifest.json');
    var manifest = readStringFromUrl(manifestUrl);
    var config = JSON.parse(manifest);
    // Set the module search path if any
    if ('module_search_path' in config) {
      for (var i=0; i<config.module_search_path.length; i++) {
        Require.moduleSearchPath.push(Services.io.newURI(config.module_search_path[i], '', manifestUrl));
      }
    }
    if ('content_scripts' in config) {
      for (i=0; i<config.content_scripts.length; i++) {
        var scriptInfo = config.content_scripts[i];
        var matches = [];
        for (var j=0; j<scriptInfo.matches.length; j++) {
          // Convert from Google's simple wildcard syntax to a proper regular expression
          matches.push(scriptInfo.matches[j].replace('*', '.*', 'g'));
        }
        var js = [];
        for (j=0; j<scriptInfo.js.length; j++) {
          // Prefix ID with ./ so we know to resolve from the base script URL.
          // (Otherwise the module path would be used.)
          js.push('./' + scriptInfo.js[j]);
        }
        contentScripts.push({
          matches: matches,
          js: js
        });
      }
    }
  }
}

function unloadBackgroundScripts() {
  require('./config').contentScripts = [];
}

// When the extension is activated:
//
function startup(data, reason) {
  dump('\Aji: starting up ...\n\n');

  // TODO: Set addon ID using preprocessor.
  AddonManager.getAddonByID('product@vendor.com', function(addon) {
    setResourceSubstitution(addon);

    loadConfig(addon);

    createBackground();
  });
}

// When the extension is deactivated:
//
function shutdown(data, reason) {
  dump('\nAji: shutting down ...\n\n');

  releaseBackground();
  unloadBackgroundScripts();

  // Unload the modules so that we will load new versions if the add-on is installed again.
  Cu.unload('resource://{{SHORTNAME}}/modules/Require.jsm');
}
