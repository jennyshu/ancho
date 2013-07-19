(function() {
  const Cc = Components.classes;
  const Ci = Components.interfaces;
  const Cu = Components.utils;

  Cu.import('resource://gre/modules/Services.jsm');
  Cu.import('resource://gre/modules/FileUtils.jsm');

  let inherits = require('inherits');
  let EventEmitter2 = require('eventemitter2').EventEmitter2;
  let Utils = require('./utils');
  let WindowWatcher = require('./windowWatcher');
  let Binder = require('./binder');

  function WindowEventEmitter(win) {
    this._window = win;
  }
  inherits(WindowEventEmitter, EventEmitter2);

  WindowEventEmitter.prototype.init = function() {
    this._window.addEventListener('unload', Binder.bind(this, 'shutdown'), false);
  };

  WindowEventEmitter.prototype.shutdown = function() {
    if (this._window) {
      this.emit('unload');
      this._window.removeEventListener('unload', Binder.unbind(this, 'shutdown'), false);
      this._window = null;
    }
  };

  function Extension(id, firstRun) {
    EventEmitter2.call(this, { wildcard: true });
    this._id = id;
    this._rootDirectory = null;
    this._firstRun = firstRun;
    this._manifest = null;
    this._windowEventEmitters = {};
    this._windowWatcher = null;
  }
  inherits(Extension, EventEmitter2);

  Object.defineProperty(Extension.prototype, 'id', {
    get: function id() {
      return this._id;
    }
  });

  Object.defineProperty(Extension.prototype, 'rootDirectory', {
    get: function rootDirectory() {
      return this._rootDirectory;
    }
  });

  Object.defineProperty(Extension.prototype, 'firstRun', {
    get: function firstRun() {
      return this._firstRun;
    }
  });

  Object.defineProperty(Extension.prototype, 'manifest', {
    get: function manifest() {
      return this._manifest;
    }
  });

  Object.defineProperty(Extension.prototype, 'windowWatcher', {
    get: function windowWatcher() {
      if (!this._windowWatcher) {
        this._windowWatcher = new WindowWatcher(this);
      }
      return this._windowWatcher;
    }
  });

  Extension.prototype.getURL = function(path) {
    var URI = NetUtil.newURI('chrome-extension://' + this._id + '/' + path, '', null);
    return URI.spec;
  };

  Extension.prototype.load = function(rootDirectory) {
    this._rootDirectory = rootDirectory;
    var initFile = this._rootDirectory.clone();
    initFile.append('__init__');
    if (!initFile.exists()) {
      // Note that firstRun may already have been forced to true
      // by the global value (if we are installing Ancho).
      this._firstRun = true;
      // Create the file so we know in subsequent runs that
      // the extension was already installed.
      initFile.create(Ci.nsIFile.NORMAL_FILE_TYPE, FileUtils.PERMS_FILE);
    }

    this._loadManifest();
  };

  Extension.prototype.unload = function() {
    if (this._windowWatcher) {
      this._windowWatcher.unload();
    }

    for (var windowId in this._windowEventEmitters) {
      this._windowEventEmitters[windowId].shutdown();
    }
    this._windowEventEmitters = {};

    this.emit('unload');
  };

  Extension.prototype.forWindow = function(win) {
    var windowId = Utils.getWindowId(win);
    var windowEventEmitter;
    if (!(windowId in this._windowEventEmitters)) {
      windowEventEmitter = new WindowEventEmitter(win);
      windowEventEmitter.init();
      this._windowEventEmitters[windowId] = windowEventEmitter;
    }
    else {
      windowEventEmitter = this._windowEventEmitters[windowId];
    }
    return windowEventEmitter;
  };

  Extension.prototype._loadManifest = function() {
    var manifestFile = this._rootDirectory.clone();
    manifestFile.append('manifest.json');
    var manifestURI = Services.io.newFileURI(manifestFile);
    var manifestString = Utils.readStringFromUrl(manifestURI);
    this._manifest = JSON.parse(manifestString);
    var i, j;
    if ('content_scripts' in this._manifest) {
      for (i=0; i<this._manifest.content_scripts.length; i++) {
        var scriptInfo = this._manifest.content_scripts[i];
        for (j=0; j<scriptInfo.matches.length; j++) {
          // Convert from Google's simple wildcard syntax to a regular expression
          // TODO: Implement proper match pattern matcher.
          scriptInfo.matches[j] = Utils.matchPatternToRegexp(scriptInfo.matches[j]);
        }
      }
    }
    if ('web_accessible_resources' in this._manifest) {
      for (i=0; i<this._manifest.web_accessible_resources.length; i++) {
        this._manifest.web_accessible_resources[i] =
          Utils.matchPatternToRegexp(this._manifest.web_accessible_resources[i]);
      }
    }
  };

  function GlobalId() {
    this._id = 1;
  }

  GlobalId.prototype.getNext = function() {
    return this._id++;
  };

  function Global() {
    EventEmitter2.call(this, { wildcard: true });
    this._extensions = {};
    this._globalIds = {};
  }
  inherits(Global, EventEmitter2);

  Global.prototype.getGlobalId = function(name) {
    if (!this._globalIds[name]) {
      this._globalIds[name] = new GlobalId();
    }
    return this._globalIds[name].getNext();
  };

  Global.prototype.getExtension = function(id) {
    return this._extensions[id];
  };

  Global.prototype.loadExtension = function(id, rootDirectory, firstRun) {
    this._extensions[id] = new Extension(id, firstRun);
    this._extensions[id].load(rootDirectory);
    return this._extensions[id];
  };

  Global.prototype.watchExtensions = function(callback) {
    for (var id in this._extensions) {
      callback(this._extensions[id]);
    }

    this.addListener('load', callback);
  };

  Global.prototype.unloadExtension = function(id) {
    this._extensions[id].unload();
    delete this._extensions[id];
  };

  Global.prototype.unloadAllExtensions = function() {
    let id;
    for (id in this._extensions) {
      this.unloadExtension(id);
    }
    this.emit('unload');
  };

  Global.prototype.shutdown = function() {
    this.unloadAllExtensions();
    this.removeAllListeners();
  };

  exports.Global = new Global();

}).call(this);