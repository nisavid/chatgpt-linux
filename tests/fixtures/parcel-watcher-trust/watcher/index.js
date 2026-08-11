"use strict";

const fs = require("node:fs");

require("parcel-watcher-transitive-fixture");
require("@parcel/watcher-linux-x64-glibc");

if (process.env.PARCEL_WATCHER_INIT_MARKER) {
  fs.writeFileSync(process.env.PARCEL_WATCHER_INIT_MARKER, "initialized\n", "utf8");
}

module.exports = { subscribe() {} };
