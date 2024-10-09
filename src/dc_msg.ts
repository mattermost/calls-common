import {Encoder, Decoder} from '@msgpack/msgpack';
import {zlibSync, unzlibSync, strToU8, strFromU8} from 'fflate';

import {DCMessageType, DCMessageSDP} from './types';

export function encodeDCMsg(enc: Encoder, msgType: DCMessageType, payload?: any) {
    const mt = enc.encode(msgType);
    if (typeof payload === 'undefined') {
        return mt;
    }

    let pl;
    if (msgType === DCMessageType.SDP) {
        pl = enc.encode(zlibSync(strToU8(JSON.stringify(payload))));
    } else {
        pl = enc.encode(payload);
    }

    // Flat encoding
    const msg = new Uint8Array(mt.byteLength + pl.byteLength);
    msg.set(mt);
    msg.set(pl, mt.byteLength);

    return msg;
}

export function decodeDCMsg(dec: Decoder, data: Uint8Array) {
    let mt;
    let payload;
    let i = 0;

    // Messages are expected to be flat (no surrounding object).
    // We also support payload-less messages (e.g. ping/pong).
    for (const val of dec.decodeMulti(data)) {
        if (i === 0) {
            mt = val;
        } else if (i === 1) {
            payload = val;
            break;
        }
        i++;
    }

    if (mt === DCMessageType.SDP) {
        payload = strFromU8(unzlibSync(payload as DCMessageSDP));
    }

    return {mt, payload};
}
