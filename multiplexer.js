/**
 * The Multiplexer is the glue between the content script
 * and the Web Inspector panel. It accepts Chrome connections
 * from both pages and relays events between the two.
 *
 * It tries to be smart, too: if the Web Inspector has not
 * yet been opened, it will queue events with data for later
 * transmission to the Web Inspector. Note that only events
 * with data are queued (rapid heartbeat status updates are
 * not needed when you are not on the Inspector as the page
 * is loading, for example).
 *
 * @class Multiplexer
 * @constructor
 * @param {Extension} extension Chrome Extension API.
 */
function Multiplexer(extension) {
    this.tabMessageQueue = {};
    this.tabOnDisconnect = {};
    this.inspectors = {};
    extension.onConnect.addListener(this.onConnect.bind(this));
}

Multiplexer.prototype.onConnect = function(incomingPort) {
    if (incomingPort.name === "contentscript") {
        this.addSource(incomingPort);
    } else if (incomingPort.name.indexOf("inspector") === 0) {
        this.addInspector(incomingPort);
    }
}

Multiplexer.prototype.addInspector = function(inspectorPort) {
    console.log("addInspector for port = ", inspectorPort);
    var tabId = inspectorPort.name.split("-")[1];
    console.log("add inspectorPort = ", inspectorPort, ", tabId = ", tabId);
    this.inspectors[tabId] = inspectorPort;
    console.log("inspectors = ", this.inspectors);

    if (tabId in this.tabMessageQueue) {
        console.log("messageQ = ", this.tabMessageQueue[tabId]);
        for (var idx in this.tabMessageQueue[tabId]) {
            inspectorPort.postMessage(this.tabMessageQueue[tabId][idx]);
        }
    }

    inspectorPort.onDisconnect.addListener(function() {
        console.log("remove inspectorPort = ", inspectorPort, ", tabId = ", tabId);
        delete this.inspectors[tabId];
    }.bind(this));
}

Multiplexer.prototype.onSourceMessage = function(tabId, data) {
    if (!(tabId in this.tabMessageQueue)) {
        console.log("WARNING: THIS TAB WAS DESTROYED = ", tabId);
    }
    console.log("onSourceMessage for tabId = ", tabId, ", data = ", data);
    console.log("inspectors = ", this.inspectors);
    if (tabId in this.inspectors) {
        var inspectorPort = this.inspectors[tabId];
        console.log("dispatching message to inspectorPort = ", inspectorPort, ", id = ", tabId);
        inspectorPort.postMessage(data);
    } else {
        console.log("inspector not found for tabId = ", tabId);
        console.log("messageQ = ", this.tabMessageQueue);
        if ("data" in data) {
            this.tabMessageQueue[tabId].push(data);
        } else {
            console.log("NOT queued, no data found (possibly heartbeat only)");
        }
    }
}

Multiplexer.prototype.addSource = function(tabPort) {
    var tabId = tabPort.sender.tab.id;
    if (!tabId) {
        throw new Error("Tab expected!");
    }

    var onMessage = this.onSourceMessage.bind(this, tabId)
    var onDisconnect = (function onDisconnect() {
        console.log("destroying tab = ", tabId);
        if (tabId in this.inspectors) {
            var inspectorPort = this.inspectors[tabId];
            inspectorPort.postMessage({
                event: "end"
            });
        }
        tabPort.onDisconnect.removeListener(this.tabOnDisconnect[tabId]);
        tabPort.onMessage.removeListener(onMessage);
        delete this.tabMessageQueue[tabId];
        delete this.tabOnDisconnect[tabId];
    }.bind(this));

    console.log("Adding onMessage for tabId = " + tabId);
    if (tabId in this.tabOnDisconnect) {
        console.log("XXX TAB ALREADY EXISTS! Going to kill the old data now.");
        // Async fun: A new port on this tab has been created
        // before the old was was disconnected.
        // Since we no longer care about the old page,
        // disconnect it now.
        this.tabOnDisconnect[tabId]();
    }
    this.tabMessageQueue[tabId] = [];
    this.tabOnDisconnect[tabId] = onDisconnect;
    tabPort.onMessage.addListener(onMessage);
    tabPort.onDisconnect.addListener(onDisconnect);
}
