"use strict";

const fs = require("node:fs");

if (process.env.PARCEL_WATCHER_LIFECYCLE_MARKER) {
  fs.writeFileSync(process.env.PARCEL_WATCHER_LIFECYCLE_MARKER, "ran\n", "utf8");
}
