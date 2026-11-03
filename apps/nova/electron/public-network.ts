import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { Agent } from "undici";
import { isBlockedAddress } from "@vestra/core/net-guard";

/** Resolve and validate inside the socket's lookup callback. No second DNS lookup occurs. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  void lookup(hostname, { all: true, verbatim: true }).then(
    (records) => {
      if (
        !records.length ||
        records.some((record) => isBlockedAddress(record.address))
      ) {
        callback(
          Object.assign(new Error("Destination is not a public address."), {
            code: "ERR_BLOCKED_ADDRESS",
          }),
          "",
          4,
        );
        return;
      }
      const family = typeof options === "number" ? options : options.family;
      const candidates = records.filter(
        (record) => !family || record.family === family,
      );
      if (!candidates.length) {
        callback(
          Object.assign(new Error("No address for the requested family."), {
            code: "ENOTFOUND",
          }),
          "",
          4,
        );
      } else if (typeof options === "object" && options.all) {
        callback(null, candidates);
      } else {
        callback(null, candidates[0]!.address, candidates[0]!.family);
      }
    },
    (error: NodeJS.ErrnoException) => callback(error, "", 4),
  );
};

// TLS still receives the original hostname for SNI/certificate verification.
export const publicDispatcher = new Agent({
  connect: { lookup: publicLookup },
});
