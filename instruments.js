function onMessage(data) {
    console.log("zomg = ", data);
}
var port = chrome.extension.connect({
    name: "contentscript"
});
port.onMessage.addListener(onMessage);

function towerHookup() {
    var point = document.getElementById("__yui_instruments_tower");
    console.log("point = ", point);
    point.addEventListener("pickup", function() {
        var data = point.content;
        data = JSON.parse(data);
        port.postMessage(data);
    });
}

(function yuiInjectableInstrumentation () {
    if ('undefined' == typeof __YUI_DISCOVERY__) {
        (function injector () {
            var inlineScript = "(" + injector.caller.toString() + ")();";

            var script = document.createElement('script');
            script.setAttribute("type", "application/javascript");
            script.textContent = "var __YUI_DISCOVERY__ = true;\n" + inlineScript;

            setTimeout(function() {
                  document.head.appendChild(script);
                  document.head.removeChild(script);
            }, 0);
      })();

      return;
    }

    function InstrumentTower () {
        var div = document.createElement("meta");
        div.id = "__yui_instruments_tower";
        div.name = "yui-rpc";
        div.content = "";
        document.head.appendChild(div);
        this.div = div;

        var ev = document.createEvent("Event");
        ev.initEvent("pickup", true, true);
        this.ev = ev;
    }

    InstrumentTower.prototype.emit = function (name, data) {
        this.div.content = JSON.stringify({
            event: name,
            data: data
        });
        this.div.dispatchEvent(this.ev);
    }

    var tower = new InstrumentTower();

    //var then = +(new Date());

    function getKeys (obj) {
        var out = [];
        for (var key in obj) {
            out.push(key);
        }
        return out;
    }

    function report () {
        var envMods = YUI.Env.mods;
        console.log(getKeys(envMods));
    //  console.log(Object.keys(envMods));
        console.log(envMods);
    }

    var useMods = {};

    function parseUseArgs (args) {
        var out = {};
        out.modules = [];
        out.missing = [];
        out.async = false;
        for (var key in args) {
            var value = args[key];
            if ("function" !== typeof value) {
                out.modules.push(value);
                if (!(value in useMods)) {
                    // This is the first time we're loading this.
                    out.missing.push(value);
                }
                useMods[value] = true;
            } else {
                out.async = true;
            }
        }
        console.log("useMods: " + getKeys(useMods).join(","));
        return out;
    }

    var profileReport = {};

    function createNumeric () {
        return {
            nonZeroPoints: 0,
            max: 0,
            min: 0,
            avg: 0
        };
    }

    function createReportEntry (name) {
        profileReport[name] = {
            calls: 0,
            asyncCalls: 0,
            syncCalls: 0,
            numerics: {
                execution: createNumeric(),
                requestedCount: createNumeric(),
                requestedStringLength: createNumeric(),
                newModuleCount: createNumeric(),
                newModuleStringLength: createNumeric(),
                roundtripModuleCount: createNumeric(),
                roundtripModuleStringLength: createNumeric()
            },
            points: []
        };
        return profileReport[name];
    }

    function recordNumeric (entry, statistic, value) {
        console.log("Data point: " + statistic + " = " + value);
        var numeric = entry.numerics[statistic];
        if (value > 0) {
            numeric.nonZeroPoints++;
        }
        if (entry.calls > 1) {
            numeric.realAvg = ((numeric.realAvg * (entry.calls - 1)) + value) / entry.calls;
            numeric.avg = ((numeric.avg * (numeric.nonZeroPoints - 1)) + value) / numeric.nonZeroPoints;
            numeric.min = Math.min(numeric.min, value);
            numeric.max = Math.max(numeric.max, value);
        } else {
            numeric.realAvg = numeric.avg = numeric.min = numeric.max = value;
        }
    }   

    function recordPoint (name, start, stop, data) {
        var entry = profileReport[name];
        if (!entry) {
            entry = createReportEntry(name);
        }

        var duration = stop - start;

        entry.calls++;
        entry.points.push({
            start: start,
            duration: duration
        });

        if (data.async) {
            entry.asyncCalls++;
        } else {
            entry.syncCalls++;
        }

        console.log("YUI use: " + data.modules.join(", ") + 
            ", total: " + data.modules.length +
            ", " + ((data.async) ? "async" : "SYNC"));
        console.log("New modules in this use: " + 
            ((data.missing.length) ? data.missing.join(", ") : "N/A"));

        tower.emit("use", {
            data: data,
            duration: duration,
            envMods: getKeys(YUI.Env.mods)
        });

        var uniqueUsed = getKeys(useMods);
        console.log("Total unique used modules: " + uniqueUsed.length);

        var envX = uniqueUsed.join(",").length;

        console.log("*** ENVX length = " + envX);
        if (YUI.Env && YUI.Env.mods) {
            var oldEnv = getKeys(YUI.Env.mods).join(",").length;
            console.log("*** Old env length = " + oldEnv);
            console.log("*** Savings = " + (oldEnv - envX) + " bytes, " + ((1 - (envX / oldEnv)) * 100) + "% reduction");
        }

        recordNumeric(entry, "execution", duration);
        recordNumeric(entry, "requestedCount", data.modules.length);
        recordNumeric(entry, "requestedStringLength", data.modules.join(",").length);
        recordNumeric(entry, "newModuleCount", data.missing.length);
        recordNumeric(entry, "newModuleStringLength", data.missing.join(",").length);

        var roundtripModules = [];
        for (var idx in data.missing) {
            var module = data.missing[idx];
            if (!(YUI.Env && YUI.Env.mods && YUI.Env.mods[module])) {
                roundtripModules.push(module);
                console.log(module + " NOT FOUND, roundtrip needed");
            }
        }
        recordNumeric(entry, "roundtripModuleCount", roundtripModules.length);
        recordNumeric(entry, "roundtripModuleStringLength", roundtripModules.join(",").length);
    }

    function instrument (name, fn) {
        return function () {
            var start = new Date(),
                returnValue = fn.apply(this, arguments);
                stop = new Date();
            
            var args = Array.prototype.slice.call(arguments, 0);
            var data = parseUseArgs(args);

            console.log("Recorded: " + (stop - start));
            recordPoint(name, start, stop, data);

            return returnValue;
        }
    }

    function dumpReportEntry (name) {
        var functionEntry = profileReport[name];
        console.log("Stats for " + name + "... calls: " + functionEntry.calls);
        tower.emit("functionReport", {
            functionName: name,
            stats: functionEntry
        });
        for (var numeric in functionEntry.numerics) {
            var entry = functionEntry.numerics[numeric];
            console.log(numeric + " avg excluding zero points: " + entry.avg + ", max: " + entry.max + ", min: " + entry.min +
                ", non-zero points: " + entry.nonZeroPoints + ", avg including zero points: " + entry.realAvg );
        }
    }

    function hijack () {
        console.log("Found YUI.");
        if (!YUI.prototype) {
            tower.emit("error");
            console.log("Failure: YUI.prototype doesn't exist.");
            return;
        }
        var _use = instrument("YUI.use", YUI.prototype.use);
        //var _add = instrument("YUI.add", YUI.prototype.add);
        if (_use) {
            YUI.prototype.use = function () {
                //console.log(getKeys(useMods));
                var value = _use.apply(this, arguments);
                dumpReportEntry("YUI.use");
                return value;
            };
        } else {
            console.log("YUI.prototype.use was not defined.");
        }
        try {
            report();
        } catch (ex) {
            console.warn("Something went wrong while reporting. " + ex.stack);
        }
    }

    if (window.YUI) {
        return hijack();
    }

    var pollTimeout, retryCount = 0;
    function yuiPoller () {
        tower.emit("heartbeat");
    console.log("Checking for YUI");
        if (window.YUI && window.YUI.prototype) {
            tower.emit("yuiFound", window.YUI.version || true);
            hijack();
        } else if (retryCount < 500) {
            retryCount++;
            pollTimeout = window.setTimeout(yuiPoller, 10);
        } else {
            tower.emit("yuiFound", false);
            console.log("Giving up, YUI not found.");
        }
    }
    yuiPoller();

    document.onreadystatechange = function () {
        if (document.readyState == "complete") {
            retryCount = 1000;
        }
    }
})();
console.log("hookup now.");
setTimeout(towerHookup, 0);
