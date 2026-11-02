import { connect } from "./shard-sdk";

/** One connection to the host per plugin frame. The shims in this folder and bootstrap.tsx all use it. */
export const sdk = connect();
