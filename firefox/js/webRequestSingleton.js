(function() {

  var Cc = Components.classes;
  var Ci = Components.interfaces;
  var Cu = Components.utils;
  var Cr = Components.results;

  function CCIN(cName, ifaceName) {
    return Cc[cName].createInstance(Ci[ifaceName]);
  }

  Cu.import('resource://gre/modules/Services.jsm');

  var Event = require('./event');
  var Utils = require('./utils');

  var HTTP_ON_MODIFY_REQUEST = 'http-on-modify-request';
  var HTTP_ON_EXAMINE_RESPONSE = 'http-on-examine-response';
  var HTTP_ON_EXAMINE_CACHED_RESPONSE = 'http-on-examine-cached-response';


  /* Exported class: WebRequestSingleton */

  function WebRequestSingleton(state, window) {
    this._state = state;
    this._tab = Utils.getWindowId(window);

    // request map
    // tabId --> URI --> { request info }
    this._requests = {};

    this._httpActivityDistributor =
        Cc["@mozilla.org/network/http-activity-distributor;1"]
        .getService(Ci.nsIHttpActivityDistributor);

    this.onCompleted = new Event(window, this._tab, this._state, 'webRequest.completed');
    this.onHeadersReceived = new Event(window, this._tab, this._state, 'webRequest.headersReceived');
    this.onBeforeRedirect = new Event(window, this._tab, this._state, 'webRequest.beforeRedirect');
    this.onAuthRequired = new Event(window, this._tab, this._state, 'webRequest.authRequired');
    this.onBeforeSendHeaders = new Event(window, this._tab, this._state, 'webRequest.beforeSendHeaders');
    this.onErrorOccurred = new Event(window, this._tab, this._state, 'webRequest.errorOccurred');
    this.onResponseStarted = new Event(window, this._tab, this._state, 'webRequest.responseStarted');
    this.onSendHeaders = new Event(window, this._tab, this._state, 'webRequest.sendHeaders');
    this.onBeforeRequest = new Event(window, this._tab, this._state, 'webRequest.beforeRequest');

    Services.obs.addObserver(this, HTTP_ON_MODIFY_REQUEST, false);
    Services.obs.addObserver(this, HTTP_ON_EXAMINE_RESPONSE, false);
    Services.obs.addObserver(this, HTTP_ON_EXAMINE_CACHED_RESPONSE, false);
    this._httpActivityDistributor.addObserver(this);

    var self = this;
    window.addEventListener('unload', function() {
      window.removeEventListener('unload', parameters.callee, false);
      Services.obs.removeObserver(self, HTTP_ON_MODIFY_REQUEST);
      Services.obs.removeObserver(self, HTTP_ON_EXAMINE_RESPONSE);
      Services.obs.removeObserver(self, HTTP_ON_EXAMINE_CACHED_RESPONSE);
      self._httpActivityDistributor.removeObserver(self);
    });
  };

  /* nsIObserver::observe() */
  WebRequestSingleton.prototype.observe = function(aSubject, aTopic, aData) {

    var httpChannel = aSubject.QueryInterface(Ci.nsIHttpChannel);

    var uri = httpChannel.URI;
    if (!uri) {
      return;
    }

    var loadContext = Utils.getLoadContext(httpChannel);
    if (!loadContext) {
      return;
    }

    var win;
    try {
      win = loadContext.associatedWindow;
    } catch (e) {
      dump('Warning: ' + e + '\n');
      return;
    }

    if (aTopic == HTTP_ON_MODIFY_REQUEST) {
      this.handleOnModifyRequest(aTopic, httpChannel, win);
    } else if ( (aTopic === HTTP_ON_EXAMINE_RESPONSE) ||
                (aTopic === HTTP_ON_EXAMINE_CACHED_RESPONSE) ) {
      this.handleOnExamineResponse(aTopic, httpChannel, win);
    }
  };

  /* nsIHttpActivityObserver::observeActivity() */
  WebRequestSingleton.prototype.observeActivity = function(aHttpChannel,
      aActivityType, aActivitySubtype, aTimestampMicrosecs, aExtraSizeData,
      aExtraStringData) {

    // FIXME TODO : implement me
    // dump('WebRequestSingleton::observeActivity()\n');
  };

  WebRequestSingleton.prototype._getFrameIds = function(win) {
    // helper function
    function getElementId(self, elem, def) {
      if (elem.frameElement) {
        if (!elem.frameElement.__apicaWID) {
          try {
            elem.frameElement.__apicaWID = self._state.getGlobalId('webRequest.frameId');
          } catch (e) {
            dump('' + e + '\n');
          }
        }
        return elem.frameElement.__apicaWID;
      } else {
        return def;
      }
    }
    // default result object (for top-level)
    var res = {
      me: 0,
      parent: -1
    };
    // top-level
    if (win === win.parent) {
      return res;
    }
    // embedded
    var w = win.parent;
    if (w === w.parent) {
      // `w` is top level
      res.parent = 0;
    } else {
      // w is not top-level
      res.parent = getElementId(this, w, 0);
    }
    res.me = getElementId(this, win, -1);
    return res;
  }

  WebRequestSingleton.prototype.handleOnModifyRequest = function(topic, httpChannel, win) {
    var url = httpChannel.URI.spec;
    var referrer  = httpChannel.referrer ? httpChannel.referrer.spec : '';
    var tabId = win.top ? Utils.getWindowId(win.top) : -1;
    var frameIds = this._getFrameIds(win);
    var loadFlags = httpChannel.loadFlags;

    var type = 'other';

    // is it main request of the tab?
    if (loadFlags & Ci.nsIChannel.LOAD_DOCUMENT_URI) {
      if (0 === frameIds.me) {
        type = 'main_frame';
        this._flagTab(tabId, 'loading');
        var self = this;
        /* FIXME: The code below does not work, we don't get the event.
           Strange thing is that at this moment, the win.document.readyState
           is set to 'complete' already. */
        win.addEventListener('DOMContentLoaded', function() {
          win.removeEventListener('DOMContentLoaded', parameters.callee, false);
          self._flagTab(tabId, null);
        });
      } else {
        type = 'sub_frame';
      }
    }

    if ('' !== referrer && !this._flagTab(tabId)) {
      type = 'xmlhttprequest';
    }

    // is it request for an image? there is no direct way, from debugging
    // experience image requests usualy have loadFlags == 0 or contain
    // LOAD_INITIAL_DOCUMENT_URI flag. But sometimes it also contains other flags.
    // Therefore there is also check for Accept header, which should ensure
    // that browser wants an image.
    // Ci.nsIRequest.LOAD_FROM_CACHE => after refresh button is clicked
    if (   loadFlags === 0
        || loadFlags & Ci.nsIChannel.LOAD_INITIAL_DOCUMENT_URI
        || loadFlags === Ci.nsIRequest.LOAD_FROM_CACHE) {
      var accept = httpChannel.getRequestHeader('Accept');
      if (accept && 0 === accept.indexOf('image/')) {
        type = 'image';
      }
    }

    // TODO: recognize other types: stylesheet, script, object

    var requestData = this._getRequest(tabId, Utils.removeFragment(url));
    var requestId = requestData
                    ? requestData.requestId
                    : this._state.getGlobalId('webRequest.requestId');

    // http://code.google.com/chrome/extensions/webRequest.html#event-onBeforeRequest
    var params = {
      tabId : tabId,
      url : url,
      timeStamp: (new Date()).getTime(),
      requestId: requestId,
      frameId: frameIds.me,
      parentFrameId: frameIds.parent,
      type : type,
      method: httpChannel.requestMethod
    };

    // store the request
    this._setRequest(tabId, Utils.removeFragment(url), {
      requestId: params.requestId,
      frameId: params.frameId,
      parentFrameId: params.parentFrameId,
      type: params.type,
      method: params.method
    });

    // fire onBeforeRequest; TODO: implement redirection
    var results = this.onBeforeRequest.fire([ params ]);
    for (var i = 0; i < results.length; i++) {
      if (results[i] && results[i].cancel) {
        httpChannel.cancel(Cr.NS_BINDING_ABORTED);
        // TODO: fire onErrorOccurred?
        this._setRequest(tabId, Utils.removeFragment(url), null);
        return;
      }
    }

    var visitor = new HttpHeaderVisitor();
    httpChannel.visitRequestHeaders(visitor);

    // fire onBeforeSendHeaders; TODO: implement changing the request headers
    params.timeStamp = (new Date()).getTime();
    params.requestHeaders = visitor.headers;
    results = this.onBeforeSendHeaders.fire([ params ]);
    for (var i = 0; i < results.length; i++) {
      if (results[i] && results[i].cancel) {
        httpChannel.cancel(Cr.NS_BINDING_ABORTED);
        // TODO: fire onErrorOccurred?
        this._setRequest(tabId, Utils.removeFragment(url), null);
        return;
      }
    }

    // fire onSendHeaders;
    // TODO: possibly include request body,
    // legacy code: firefox/components/apicawatch.js:535
    params.timeStamp = (new Date()).getTime();
    this.onSendHeaders.fire([ params ]);

    // dispatching dedicated listening thread for in case the request
    // will be servered completely from cache
    var mainThread = Cc["@mozilla.org/thread-manager;1"].getService().mainThread;
    mainThread.dispatch(new ListenerThread({
        id: tabId,
        uri: Utils.removeFragment(url),
        monitor: this
      }, httpChannel),
      Ci.nsIThread.DISPATCH_NORMAL
    );
  };

  WebRequestSingleton.prototype.handleOnExamineResponse = function(topic, httpChannel, win) {
    var url = httpChannel.URI.spec;
    var tabId = win.top ? Utils.getWindowId(win.top) : -1;

    var requestData = this._getRequest(tabId, Utils.removeFragment(url));
    if (!requestData) {
      // we are not monitoring this request
      return;
    }

    var visitor = new HttpHeaderVisitor();
    httpChannel.visitResponseHeaders(visitor);

    var statusCode = httpChannel.responseStatus;
    var statusText = httpChannel.responseStatusText;

    var params = {
      tabId : tabId,
      url : url,
      timeStamp: (new Date()).getTime(),
      responseHeaders: visitor.headers,
      statusLine: '' + statusCode + ' ' + statusText,
      // stored values:
      requestId: requestData.requestId,
      frameId: requestData.frameId,
      parentFrameId: requestData.parentFrameId,
      type : requestData.type,
      method: requestData.method
    };

    // fire onHeadersReceived; TODO: implement changing the response headers
    var results = this.onHeadersReceived.fire([ params ]);

    params.statusCode = statusCode;
    params.fromCache = (HTTP_ON_EXAMINE_CACHED_RESPONSE === topic);

    // TODO: get IP address of the remote server
    // params.ip = ???

    // fire onBeforeRedirect
    var redirected = (statusCode >= 300 && statusCode < 400);
    if (redirected) {
      params.timeStamp = (new Date()).getTime();
      params.redirectUrl = httpChannel.getResponseHeader('Location');
      this._setRequest(tabId, Utils.removeFragment(url), null);
      this._setRequest(tabId, Utils.removeFragment(params.redirectUrl), requestData);
      this.onBeforeRedirect.fire([ params ]);
      return;
    }

    // TODO: fire onAuthRequired

    // terminating leg
    this._setRequest(tabId, Utils.removeFragment(url), params);

    // fire onResponseStarted
    params.timeStamp = (new Date()).getTime();
    this.onResponseStarted.fire([ params ]);
  };

  // get request-related data
  WebRequestSingleton.prototype._getRequest = function(tabId, uri) {
    if (!(tabId in this._requests)) {
      return null;
    }
    return this._requests[tabId][uri];
  };

  // store or delete (request == null) request-related data
  WebRequestSingleton.prototype._setRequest = function(tabId, uri, request) {
    var tab = this._requests[tabId];
    if (!tab) {
      tab = this._requests[tabId] = {};
    }
    if (!request) {
      delete tab[uri];
    } else {
      tab[uri] = request;
    }
    return request;
  };

  // get (flag parameter missing) or set tab flag
  WebRequestSingleton.prototype._flagTab = function(tabId, flag) {
    var tab = this._requests[tabId];
    if (!tab) {
      tab = this._requests[tabId] = {};
    }
    if ('undefined' !== typeof(flag)) {
      tab.flag = flag;
    }
    return tab.flag;
  };


  //
  // Helper classes
  //


  /* HttpHeaderVisitor */

  function HttpHeaderVisitor() {
    this.headers = [];
    this.originalHeaders = [];
  };

  HttpHeaderVisitor.prototype.visitHeader = function(aHeader, aValue) {
    this.headers.push({
      name : aHeader,
      value : aValue
    });
    this.originalHeaders.push({
      name : aHeader,
      value : aValue
    });
  };


  /* ListenerThread */

  // Thread listening on a request, created in WebRequestSingleton::handleOnModifyRequest().
  // It attaches an StreamListener (defined below) to provided HTTP `channel`.

  function ListenerThread(requestData, channel) {
    this.requestData = requestData;
    this.channel = channel;
  }

  ListenerThread.prototype.run = function() {
    var listener = new StreamListener(this.requestData);
    var origListener = this.channel
      .QueryInterface(Ci.nsITraceableChannel)
      .setNewListener(listener);
    if (origListener) {
      listener.setOriginalListener(origListener);
    }
  };

  ListenerThread.prototype.QueryInterface = function(iid) {
    if (iid.equals(Ci.nsIRunnable) || iid.equals(Ci.nsISupports)) {
      return this;
    }
    throw Cr.NS_ERROR_NO_INTERFACE;
  };


  /* StreamListener */

  // Class listening for events on a http request.

  function StreamListener(requestData) {
    this.requestData = requestData;
    this.originalListener = null;
    this.receivedData = [];
  }

  StreamListener.prototype.setOriginalListener = function(listener) {
    this.originalListener = listener;
  };

  // nsIRequestObserver::onStartRequest
  StreamListener.prototype.onStartRequest = function(request, context) {
    // dump('+++ StreamListener.onStartRequest()\n');
    return this.originalListener.onStartRequest(request, context);
  };

  //  nsIRequestObserver::onStopRequest
  StreamListener.prototype.onStopRequest = function(request, context, statusCode) {

    var data = this.requestData.monitor._getRequest(
        this.requestData.id,
        this.requestData.uri
      );
    if (data) {
      data.timeStamp = (new Date()).getTime();
      this.requestData.monitor._setRequest(this.requestData.id, this.requestData.uri, null);
      switch (statusCode) {
        case Cr.NS_OK:
          // fire onCompleted
          this.requestData.monitor.onCompleted.fire([ data ]);
          break;

        case Cr.NS_BINDING_REDIRECTED:
          // handleOnExamineResponse() already took care about onBeforeRedirect event
          break;

        default:
          // TODO:
          // (1) error mapping to some useful strings
          // (2) this code is not invoked in some cases, e.g. for <script> tags
          //     with invalid "src".  so need to investigate:
          //     (a) what errors are covered here, and
          //     (b) how to cover the remaining ones we need.
          data.error = 'Error ' + statusCode;
          this.requestData.monitor.onErrorOccurred.fire([ data ]);
          break;
      }
      /*
      var err = Mapping.mapHttpError(statusCode);
      var ar = this.apicaRequest;
      ar.errorCode = err.code;
      ar.errorMsg = err.msg;
      */
    }

    return this.originalListener.onStopRequest(request, context, statusCode);
  };

  // nsIStreamListener::onDataAvailable
  StreamListener.prototype.onDataAvailable = function(request,
        context, stream, offset, count) {
    /*
    dump('+++ StreamListener.onDataAvailable()\n');

    var binaryInputStream = CCIN("@mozilla.org/binaryinputstream;1", "nsIBinaryInputStream");
    var storageStream = CCIN("@mozilla.org/storagestream;1", "nsIStorageStream");
    var binaryOutputStream = CCIN("@mozilla.org/binaryoutputstream;1", "nsIBinaryOutputStream");

    binaryInputStream.setInputStream(stream);
    storageStream.init(8192, count, null);
    binaryOutputStream.setOutputStream(storageStream.getOutputStream(0));

    var data = binaryInputStream.readBytes(count);
    binaryOutputStream.writeBytes(data, count);

    this.receivedData.push(data);

    // let other listeners use the stream
    var stream = storageStream.newInputStream(0);
    */
    return this.originalListener.onDataAvailable(request, context, stream, offset, count);
  }


  module.exports = WebRequestSingleton;

}).call(this);
