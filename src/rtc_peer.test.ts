import {expect, describe, it, beforeEach, afterEach} from '@jest/globals';

import {RTCPeer, signalingLockCheckIntervalMs} from './rtc_peer';
import * as dcMsg from './dc_msg';

// Mock the dc_msg module
jest.mock('./dc_msg');

describe('RTCPeer', () => {
    let peer: RTCPeer;
    let mockConfig: RTCPeerConfig;
    let mockPC: RTCPeerConnection;
    let mockDC: RTCDataChannel;

    beforeEach(() => {
        // Setup mocks for dc_msg
        jest.mocked(dcMsg.encodeDCMsg).mockReturnValue(new Uint8Array([1]));
        jest.mocked(dcMsg.encodeDCMsg).mockImplementation(() => ({}));

        // Mock RTCPeerConnection
        mockPC = {
            createDataChannel: jest.fn(),
            onnegotiationneeded: null,
            onicecandidate: null,
            oniceconnectionstatechange: null,
            onconnectionstatechange: null,
            ontrack: null,
            close: jest.fn(),
        };

        // Mock DataChannel
        mockDC = {
            readyState: 'open',
            binaryType: 'arraybuffer',
            onmessage: null,
            send: jest.fn(),
        };

        // Mock logger
        const mockLogger = {
            logDebug: jest.fn(),
            logErr: jest.fn(),
            logWarn: jest.fn(),
            logInfo: jest.fn(),
        };

        mockConfig = {
            iceServers: [],
            logger: mockLogger,
            simulcast: false,
            dcSignaling: true,
            dcLocking: true,
        };

        // Mock RTCPeerConnection constructor
        global.RTCPeerConnection = jest.fn().mockImplementation(() => mockPC);
        mockPC.createDataChannel.mockReturnValue(mockDC);

        // Mock setInterval and setTimeout
        jest.useFakeTimers();

        // Create RTCPeer instance
        peer = new RTCPeer(mockConfig);

        // Expose private properties for testing
        peer.dc = mockDC;
        peer.dcNegotiated = true;
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    describe('grabSignalingLock', () => {
        it('should resolve when lock is acquired', async () => {
            // Setup the test to simulate a successful lock acquisition
            const lockPromise = peer.grabSignalingLock(1000);

            // Simulate the server responding with a successful lock acquisition
            const dcLockResponseCb = peer.dcLockResponseCb;
            expect(dcLockResponseCb).toBeTruthy();

            // Verify that the lock request was sent
            expect(mockDC.send).toHaveBeenCalledTimes(1);

            // Simulate server response (lock acquired)
            dcLockResponseCb(true);

            // Wait for the promise to resolve
            await expect(lockPromise).resolves.toBeUndefined();

            // Verify that the callback was cleared
            expect(peer.dcLockResponseCb).toBeNull();
        });

        it('should retry when lock is not acquired', async () => {
            // Setup the test
            const lockPromise = peer.grabSignalingLock(1000);

            // Get the callback
            const dcLockResponseCb = peer.dcLockResponseCb;

            // Simulate server response (lock not acquired)
            dcLockResponseCb(false);

            // Fast-forward timers to trigger the retry
            jest.advanceTimersByTime(signalingLockCheckIntervalMs + 10);

            // Verify that another lock request was sent
            expect(mockDC.send).toHaveBeenCalledTimes(2);

            // Now simulate a successful lock acquisition
            dcLockResponseCb(true);

            // Wait for the promise to resolve
            await expect(lockPromise).resolves.toBeUndefined();
        });

        it('should reject when timeout occurs', async () => {
            // Setup the test
            const lockPromise = peer.grabSignalingLock(1000);

            // Fast-forward timers to trigger the timeout
            jest.advanceTimersByTime(1000);

            // Wait for the promise to reject
            await expect(lockPromise).rejects.toThrow('timed out waiting for lock');

            // Verify that the callback was cleared
            expect(peer.dcLockResponseCb).toBeNull();
        });

        it('should queue lock request when data channel is not ready', async () => {
            // Set data channel to not ready
            mockDC.readyState = 'connecting';

            // Setup the test
            const lockPromise = peer.grabSignalingLock(1000);

            // Verify that no lock request was sent immediately
            expect(mockDC.send).not.toHaveBeenCalled();

            // Now set data channel to ready and simulate a successful lock acquisition
            mockDC.readyState = 'open';

            // Fast-forward timers to trigger the retry
            jest.advanceTimersByTime(signalingLockCheckIntervalMs + 10);

            // Verify that a lock request was queued
            expect(mockDC.send).toHaveBeenCalledTimes(1);

            // Get the callback
            const dcLockResponseCb = peer.dcLockResponseCb;

            // Simulate server response (lock acquired)
            dcLockResponseCb(true);

            // Wait for the promise to resolve
            await expect(lockPromise).resolves.toBeUndefined();
        });

        it('should queue lock request when data channel is not negotiated', async () => {
            // Set data channel to not negotiated
            peer.dcNegotiated = false;

            // Setup the test
            const lockPromise = peer.grabSignalingLock(1000);

            // Verify that no lock request was sent immediately
            expect(mockDC.send).not.toHaveBeenCalled();

            // Now set data channel to negotiated and simulate a successful lock acquisition
            peer.dcNegotiated = true;

            // Fast-forward timers to trigger the retry
            jest.advanceTimersByTime(signalingLockCheckIntervalMs + 10);

            // Verify that a lock request was queued
            expect(mockDC.send).toHaveBeenCalledTimes(1);

            // Get the callback
            const dcLockResponseCb = peer.dcLockResponseCb;

            // Simulate server response (lock acquired)
            dcLockResponseCb(true);

            // Wait for the promise to resolve
            await expect(lockPromise).resolves.toBeUndefined();
        });

        it('should handle multiple failures to acquire the lock', async () => {
            // Setup the test
            const lockPromise = peer.grabSignalingLock(1000);

            // Get the callback
            const dcLockResponseCb = peer.dcLockResponseCb;

            // Simulate multiple failed attempts to acquire the lock
            for (let i = 0; i < 5; i++) {
                // Simulate server response (lock not acquired)
                dcLockResponseCb(false);

                // Fast-forward timers to trigger the retry
                jest.advanceTimersByTime(signalingLockCheckIntervalMs + 10);

                // Verify that another lock request was sent
                expect(mockDC.send).toHaveBeenCalledTimes(i + 2);
            }

            // Now simulate a successful lock acquisition
            dcLockResponseCb(true);

            // Wait for the promise to resolve
            await expect(lockPromise).resolves.toBeUndefined();

            // Verify that the callback was cleared
            expect(peer.dcLockResponseCb).toBeNull();
        });

        it('should handle data channel not ready after first attempt', async () => {
            // Setup the test
            const lockPromise = peer.grabSignalingLock(1000);

            // Verify that the lock request was sent
            expect(mockDC.send).toHaveBeenCalledTimes(1);

            // Get the callback
            const dcLockResponseCb = peer.dcLockResponseCb;

            // Simulate server response (lock not acquired)
            dcLockResponseCb(false);

            // Set data channel to not ready for the next attempts
            mockDC.readyState = 'connecting';

            // Try multiple times with data channel not ready
            // Fast-forward timers to trigger the retries
            jest.advanceTimersByTime((signalingLockCheckIntervalMs * 3) + 10);

            // Verify that no additional lock request was sent (channel not ready)
            expect(mockDC.send).toHaveBeenCalledTimes(1);

            // Now set data channel back to ready
            mockDC.readyState = 'open';

            // Fast-forward timers again to trigger another retry
            jest.advanceTimersByTime(50);

            // Verify that another lock request was sent
            expect(mockDC.send).toHaveBeenCalledTimes(2);

            // Simulate successful lock acquisition
            dcLockResponseCb(true);

            // Wait for the promise to resolve
            await expect(lockPromise).resolves.toBeUndefined();

            // Verify that the callback was cleared
            expect(peer.dcLockResponseCb).toBeNull();
        });

        it('should handle data channel getting closed during lock acquisition', async () => {
            // Setup the test
            const lockPromise = peer.grabSignalingLock(1000);

            // Verify that the lock request was sent
            expect(mockDC.send).toHaveBeenCalledTimes(1);

            // Get the callback
            const dcLockResponseCb = peer.dcLockResponseCb;

            // Simulate server response (lock not acquired)
            dcLockResponseCb(false);

            // Set data channel to closed state
            mockDC.readyState = 'closed';

            // Fast-forward timers to trigger the retry
            jest.advanceTimersByTime(signalingLockCheckIntervalMs + 10);

            // Verify that no additional lock request was sent (channel closed)
            expect(mockDC.send).toHaveBeenCalledTimes(1);

            // Fast-forward timers again to check if it continues trying
            jest.advanceTimersByTime(signalingLockCheckIntervalMs + 10);

            // Verify that no more attempts were made with closed channel
            expect(mockDC.send).toHaveBeenCalledTimes(1);

            // Fast-forward to trigger timeout
            jest.advanceTimersByTime(1000);

            // Wait for the promise to reject due to timeout
            await expect(lockPromise).rejects.toThrow('timed out waiting for lock');

            // Verify that the callback was cleared
            expect(peer.dcLockResponseCb).toBeNull();
        });

        it('should handle data channel that never opens and transitions to closed', async () => {
            // Set data channel to connecting state initially
            mockDC.readyState = 'connecting';

            // Setup the test
            const lockPromise = peer.grabSignalingLock(1000);

            // Verify that no lock request was sent immediately (channel not ready)
            expect(mockDC.send).not.toHaveBeenCalled();

            // Transition data channel directly to closed state
            mockDC.readyState = 'closed';

            // Fast-forward timers multiple times to check if it continues trying
            jest.advanceTimersByTime((signalingLockCheckIntervalMs * 3) + 10);

            // Verify that no lock requests were sent (channel closed)
            expect(mockDC.send).not.toHaveBeenCalled();

            // Fast-forward to trigger timeout
            jest.advanceTimersByTime(1000);

            // Wait for the promise to reject due to timeout
            await expect(lockPromise).rejects.toThrow('timed out waiting for lock');

            // Verify that the callback was cleared
            expect(peer.dcLockResponseCb).toBeNull();
        });
    });
});
