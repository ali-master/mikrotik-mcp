/**
 * MTWEI — MikroTik's EC-SRP authentication for MAC-Telnet (the modern default).
 *
 * Classic MD5 MAC-Telnet auth is rejected by current RouterOS (verified on CHR
 * 7.23: a stock device offers a 16-byte salt but refuses the MD5 proof even for
 * valid credentials). The supported method is MTWEI — the EC-SRP5 proof (see
 * `ec-srp5.ts`) wrapped in MAC-Telnet's control framing. The password never
 * crosses the wire; MTWEI authenticates the login but does **not** encrypt the
 * subsequent terminal stream.
 *
 * The curve math, point encoding, identity validator, keygen, and client proof
 * are the protocol-agnostic EC-SRP5 core in `ec-srp5.ts`. This module adds the
 * MAC-Telnet-specific framing (the username-prefixed offer value) and re-exports
 * the EC-SRP5 primitives under their historical `mtwei*` names.
 */
import { concatBytes } from "./ec-srp5";

export {
  decodePoint,
  EC_SRP5_PUBKEY_LEN as MTWEI_PUBKEY_LEN,
  EC_SRP5_VALIDATOR_LEN as MTWEI_VALIDATOR_LEN,
  type EcSrp5Keypair as MtweiKeypair,
  ecSrp5ClientProof as mtweiDocrypto,
  ecSrp5Curve as mtweiCurve,
  ecSrp5Id as mtweiId,
  ecSrp5Keygen as mtweiKeygen,
  encodePoint,
} from "./ec-srp5";

/** Build the client MTWEI offer value: `username ‖ 0x00 ‖ 33-byte pubkey`. */
export function mtweiOfferValue(username: string, publicKey: Uint8Array): Uint8Array {
  return concatBytes([new TextEncoder().encode(username), Uint8Array.of(0), publicKey]);
}
