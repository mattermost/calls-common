import { Encoder, Decoder } from '@msgpack/msgpack';
import { DCMessageType } from './types';
export declare function encodeDCMsg(enc: Encoder, msgType: DCMessageType, payload?: any): Uint8Array;
export declare function decodeDCMsg(dec: Decoder, data: Uint8Array): {
    mt: unknown;
    payload: unknown;
};
