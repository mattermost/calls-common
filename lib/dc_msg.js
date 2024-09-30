import { zlibSync, unzlibSync, strToU8, strFromU8 } from 'fflate';
import { DCMessageType } from './types';
export function encodeDCMsg(enc, msgType, payload) {
    const mt = enc.encode(msgType);
    if (!payload) {
        return mt;
    }
    const pl = msgType === DCMessageType.SDP ?
        enc.encode(zlibSync(strToU8(JSON.stringify(payload)))) : enc.encode(JSON.stringify(payload));
    // Flat encoding
    const msg = new Uint8Array(mt.byteLength + pl.byteLength);
    msg.set(mt);
    msg.set(pl, mt.byteLength);
    return msg;
}
export function decodeDCMsg(dec, data) {
    let mt;
    let payload;
    let i = 0;
    // Messages are expected to be flat (no surrounding object).
    // We also support payload-less messages (e.g. ping/pong).
    for (const val of dec.decodeMulti(data)) {
        if (i === 0) {
            mt = val;
        }
        else if (i === 1) {
            payload = val;
            break;
        }
        i++;
    }
    if (mt === DCMessageType.SDP) {
        payload = strFromU8(unzlibSync(payload));
    }
    return { mt, payload };
}
