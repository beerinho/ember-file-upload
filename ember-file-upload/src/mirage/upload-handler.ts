import RSVP from 'rsvp';
import { extractFormData, extractFileMetadata } from './utils.ts';
import {
  macroCondition,
  dependencySatisfies,
  importSync,
} from '@embroider/macros';

const NETWORK = {
  wired: 50000, // 500 Mb/s
  wifi: 15000, // 15 Mb/s
  dsl: 1000, // 1 Mb/s
  '4g': 3000, // 4 Mb/s
  '3g': 250, // 250 kb/s
  '2g': 50, // 50 kb/s
  gprs: 20, // 20 kb/s
  offline: 0,
};

interface FakeRequest {
  requestBody: FormData | object; // Replaced with an object by this handler
  upload: {
    onloadstart: (event: ProgressEvent<EventTarget>) => void;
    onprogress: (event: ProgressEvent<EventTarget>) => void;
    onloadend: (event: ProgressEvent<EventTarget>) => void;
  };
}

export function uploadHandler(
  fn: (this: void, db: unknown, request: FakeRequest) => void,
  options = { network: null, timeout: null },
) {
  if (macroCondition(dependencySatisfies('miragejs', '*'))) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { Response } = importSync('miragejs') as { Response: any };
    return function (db: unknown, request: FakeRequest) {
      let speed = Infinity;

      if (options.network && NETWORK[options.network]) {
        speed = NETWORK[options.network] * 1024;
      }

      const { file, data } = extractFormData(request.requestBody as FormData);
      let loaded = 0;
      const total = file.value.size;

      return new RSVP.Promise((resolve) => {
        const start = new Date().getTime();

        request.upload.onloadstart(
          new ProgressEvent('loadstart', {
            lengthComputable: true,
            total,
            loaded: Math.min(loaded, total),
          }),
        );

        const upload = async () => {
          const timedOut =
            options.timeout && new Date().getTime() - start > options.timeout;
          if (timedOut || loaded >= total) {
            request.upload.onloadend(
              new ProgressEvent('loadend', {
                lengthComputable: true,
                // For the loadend event the `total` value may be sourced from the `Content-Length` response header of the upload endpoint.
                // In which case it may represent the size of the response rather than the number of uploaded bytes.
                // So we set it to an arbitrary value to make sure this doesn't influence file upload and queue progress stats.
                // See: https://developer.mozilla.org/en-US/docs/Web/API/ProgressEvent/total
                total: 300,
                loaded: Math.min(loaded, total),
              }),
            );

            const metadata = await extractFileMetadata(file.value);
            request.requestBody = { [file.key]: metadata, ...data };

            if (timedOut) {
              resolve(new Response(408));
              return;
            }

            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            resolve(fn.call(this, db, request));
          } else {
            request.upload.onprogress(
              new ProgressEvent('progress', {
                lengthComputable: true,
                total,
                loaded,
              }),
            );

            loaded += speed / 20;
            setTimeout(upload, 50);
          }
        };
        upload();
      });
    };
  } else {
    throw new Error('You must add miragejs to your app to use this helper.');
  }
}
