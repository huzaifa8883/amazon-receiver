#!/usr/bin/env python3
"""Local WSS mock sender for development only. NOT an Oracle server installer.

Requires: pip install websockets
Usage: MOCK_RECEIVER_TOKEN='test-only-device-secret' python3 tools/mock_oracle_broadcast.py \
        --cert /path/to/test-cert.pem --key /path/to/test-key.pem

Use a trusted TLS certificate for Chrome or exercise protocol in unit tests.
Never publish this test endpoint or reuse production credentials.
"""
import argparse
import asyncio
import datetime
import json
import os
import ssl
import uuid

from websockets.asyncio.server import serve


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


async def run_client(sock, token, receiver_id, count, interval):
    try:
        raw = await asyncio.wait_for(sock.recv(), timeout=10)
        msg = json.loads(raw)
    except Exception:
        await sock.close(code=1008, reason='Authentication required')
        return
    if msg.get('type') != 'authenticate' or msg.get('token') != token or msg.get('receiver_id') != receiver_id:
        await sock.send(json.dumps({'type': 'auth_error'}))
        await sock.close(code=1008, reason='Authentication rejected')
        return
    await sock.send(json.dumps({'type': 'authenticated', 'receiver_id': receiver_id}))
    print('Authenticated test receiver:', receiver_id, flush=True)

    async def pings():
        async for raw in sock:
            try:
                m = json.loads(raw)
                if m.get('type') == 'ping':
                    await sock.send(json.dumps({'type': 'pong'}))
            except (ValueError, TypeError):
                continue

    ping_task = asyncio.create_task(pings())
    try:
        for i in range(count):
            await asyncio.sleep(interval)
            if sock.close_code is not None:
                break
            message = {
                'type': 'new_job_detected',
                'event_id': str(uuid.uuid4()),
                'job_id': f'MOCK-JOB-{i + 1}',
                'detected_at': now(),
                'detector_id': 'mock-detector-01',
            }
            await sock.send(json.dumps(message))
            print('Sent simulated signal', i + 1, flush=True)
        await ping_task
    finally:
        ping_task.cancel()


def main():
    p = argparse.ArgumentParser(description='Mock Oracle WSS signal broadcaster (test only)')
    p.add_argument('--cert', required=True)
    p.add_argument('--key', required=True)
    p.add_argument('--port', type=int, default=9443)
    p.add_argument('--receiver-id', default='receiver-01')
    p.add_argument('--count', type=int, default=2)
    p.add_argument('--interval', type=float, default=1.0)
    args = p.parse_args()
    token = os.environ.get('MOCK_RECEIVER_TOKEN')
    if not token or len(token) < 12:
        raise SystemExit('Set MOCK_RECEIVER_TOKEN (12+ chars), not a production credential.')
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(args.cert, args.key)

    async def server():
        async with serve(lambda ws: run_client(ws, token, args.receiver_id, args.count, args.interval), '127.0.0.1', args.port, ssl=tls):
            print('Test-only WSS listener on loopback port', args.port, flush=True)
            await asyncio.Future()

    asyncio.run(server())


if __name__ == '__main__':
    main()
