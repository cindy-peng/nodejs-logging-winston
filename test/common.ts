// Copyright 2016 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as assert from 'assert';
import {describe, it, beforeEach} from 'mocha';
import * as nodeutil from 'util';
import * as proxyquire from 'proxyquire';
import {Options} from '../src';
import {Entry, Logging, LogSync, Log} from '@google-cloud/logging';
import * as instrumentation from '@google-cloud/logging/build/src/utils/instrumentation';
import {LoggingCommon} from '../src/common';

declare const global: {[index: string]: {} | null};

interface Metadata {
  value(): void;
  labels?: {label2?: string};
}

describe('logging-common', () => {
  let fakeLogInstance: Logging;
  let fakeLoggingOptions_: Options | null;
  let fakeLogName_: string | null;
  let fakeLogOptions_: object | null;

  function fakeLogging(options: Options) {
    fakeLoggingOptions_ = options;
    return {
      log: (logName: string, logOptions: object) => {
        fakeLogName_ = logName;
        fakeLogOptions_ = logOptions;
        return fakeLogInstance;
      },
    };
  }

  class FakeTransport {
    // transportCalledWith_ takes arguments which cannot be determined type.
    transportCalledWith_: Array<{}>;
    constructor(...args: Array<{}>) {
      this.transportCalledWith_ = args;
    }
  }

  const fakeWinston = {
    transports: {},
    Transport: FakeTransport,
  };

  const loggingCommonLib = proxyquire('../src/common', {
    '@google-cloud/logging': {
      Logging: fakeLogging,
    },
    winston: fakeWinston,
  });

  // loggingCommon is loggingCommon namespace which cannot be determined type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loggingCommon: any;

  const OPTIONS: Options = {
    logName: 'log-name',
    levels: {
      one: 1,
      six: 6,
    },
    resource: {},
    serviceContext: {
      service: 'fake-service',
    },
  };

  beforeEach(() => {
    fakeLogInstance = {} as unknown as Logging;
    fakeLoggingOptions_ = null;
    fakeLogName_ = null;
    loggingCommon = new loggingCommonLib.LoggingCommon(OPTIONS);
  });

  describe('instantiation', () => {
    it('should default to logging.write scope', () => {
      assert.deepStrictEqual((fakeLoggingOptions_ as Options).scopes, [
        'https://www.googleapis.com/auth/logging.write',
      ]);
    });

    it('should initialize Log instance using provided scopes', () => {
      const fakeScope = 'fake scope';

      const optionsWithScopes: Options = Object.assign({}, OPTIONS);
      optionsWithScopes.scopes = fakeScope;

      new loggingCommonLib.LoggingCommon(optionsWithScopes);

      assert.deepStrictEqual(fakeLoggingOptions_, optionsWithScopes);
    });

    it('should localize inspectMetadata to default value', () => {
      assert.strictEqual(loggingCommon.inspectMetadata, false);
    });

    it('should localize the provided options.inspectMetadata', () => {
      const optionsWithInspectMetadata = Object.assign({}, OPTIONS, {
        inspectMetadata: true,
      });

      const loggingCommon = new loggingCommonLib.LoggingCommon(
        optionsWithInspectMetadata
      );
      assert.strictEqual(loggingCommon.inspectMetadata, true);
    });

    it('should localize provided levels', () => {
      assert.strictEqual(loggingCommon.levels, OPTIONS.levels);
    });

    it('should default to npm levels', () => {
      const optionsWithoutLevels = Object.assign({}, OPTIONS);
      delete optionsWithoutLevels.levels;

      const loggingCommon = new loggingCommonLib.LoggingCommon(
        optionsWithoutLevels
      );
      assert.deepStrictEqual(loggingCommon.levels, {
        error: 3,
        warn: 4,
        info: 6,
        http: 6,
        verbose: 7,
        debug: 7,
        silly: 7,
      });
    });

    it('should localize Log instance using default name', () => {
      const logName = 'log-name-override';

      const optionsWithLogName = Object.assign({}, OPTIONS);
      optionsWithLogName.logName = logName;

      const loggingCommon = new loggingCommonLib.LoggingCommon(
        optionsWithLogName
      );

      const loggingOptions = Object.assign({}, fakeLoggingOptions_);
      delete (loggingOptions as Options).scopes;

      assert.deepStrictEqual(loggingOptions, optionsWithLogName);
      assert.strictEqual(fakeLogName_, logName);
      assert.strictEqual(loggingCommon.logName, logName);
    });

    it('should set removeCircular to true', () => {
      new loggingCommonLib.LoggingCommon(OPTIONS);

      assert.deepStrictEqual(fakeLogOptions_, {
        removeCircular: true,
        maxEntrySize: 250000,
      });
    });

    it('should localize the provided resource', () => {
      assert.strictEqual(loggingCommon.resource, OPTIONS.resource);
    });

    it('should localize the provided service context', () => {
      assert.strictEqual(loggingCommon.serviceContext, OPTIONS.serviceContext);
    });

    it('should create LogCommon with LogSync', () => {
      const optionsWithRedirectToStdout = Object.assign({}, OPTIONS, {
        redirectToStdout: true,
      });
      const loggingCommon = new LoggingCommon(optionsWithRedirectToStdout);
      assert.ok(loggingCommon.cloudLog instanceof LogSync);
    });

    it('should create LogCommon with LogSync and useMessage is on', () => {
      const optionsWithRedirectToStdoutAndUseMessage = Object.assign(
        {},
        OPTIONS,
        {
          redirectToStdout: true,
          useMessageField: true,
        }
      );
      const loggingCommon = new LoggingCommon(
        optionsWithRedirectToStdoutAndUseMessage
      );
      assert.ok(loggingCommon.cloudLog instanceof LogSync);
      assert.ok(loggingCommon.cloudLog.useMessageField_ === true);
    });

    it('should create LogCommon with Log', () => {
      const loggingCommon = new LoggingCommon(OPTIONS);
      assert.ok(loggingCommon.cloudLog instanceof Log);
    });
  });

  describe('log', () => {
    const LEVEL = Object.keys(OPTIONS.levels as {[name: string]: number})[0];
    const INFO = Object.keys(OPTIONS.levels as {[name: string]: number})[1];
    const STACKDRIVER_LEVEL = 'alert'; // (code 1)
    const MESSAGE = 'message';
    const METADATA = {
      value: () => {},
    };

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeLogInstance.entry = (() => {}) as any;
      loggingCommon.cloudLog.emergency = () => {};
      loggingCommon.cloudLog[STACKDRIVER_LEVEL] = () => {};
    });

    it('should throw on a bad log level', () => {
      assert.throws(() => {
        loggingCommon.log(
          'non-existent-level',
          MESSAGE,
          METADATA,
          assert.ifError
        );
      }, /Unknown log level: non-existent-level/);
    });

    it('should not throw on `0` log level', () => {
      const options = Object.assign({}, OPTIONS, {
        levels: {
          zero: 0,
        },
      });

      loggingCommon = new loggingCommonLib.LoggingCommon(options);

      loggingCommon.log('zero', 'test message');
    });

    it('should properly create an entry', done => {
      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        assert.deepStrictEqual(entryMetadata, {
          resource: loggingCommon.resource,
        });
        assert.deepStrictEqual(data, {
          message: MESSAGE,
          metadata: METADATA,
        });
        done();
      };

      loggingCommon.log(LEVEL, MESSAGE, METADATA, assert.ifError);
    });

    it('should append stack when metadata is an error', done => {
      const error = {
        stack: 'the stack',
      };

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        assert.deepStrictEqual(data, {
          message: MESSAGE + ' ' + error.stack,
          metadata: error,
          serviceContext: OPTIONS.serviceContext,
        });
        done();
      };

      loggingCommon.log(LEVEL, MESSAGE, error, assert.ifError);
    });

    it('should use stack when metadata is err without message', done => {
      const error = {
        stack: 'the stack',
      };

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        assert.deepStrictEqual(data, {
          message: error.stack,
          metadata: error,
          serviceContext: OPTIONS.serviceContext,
        });
        done();
      };

      loggingCommon.log(LEVEL, '', error, assert.ifError);
    });

    it('should inspect metadata when inspectMetadata is set', done => {
      loggingCommon.inspectMetadata = true;

      loggingCommon.cloudLog.entry = (_: {}, data: {}) => {
        const expectedWinstonMetadata = {};

        for (const prop of Object.keys(METADATA)) {
          // metadata does not have index signature.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (expectedWinstonMetadata as any)[prop] =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            nodeutil.inspect((METADATA as any)[prop]);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assert.deepStrictEqual((data as any).metadata, expectedWinstonMetadata);

        done();
      };

      loggingCommon.log(LEVEL, MESSAGE, METADATA, assert.ifError);
    });

    it('should promote httpRequest property to metadata', done => {
      const HTTP_REQUEST = {
        statusCode: 418,
      };
      const metadataWithRequest = Object.assign(
        {
          httpRequest: HTTP_REQUEST,
        },
        METADATA
      );

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        assert.deepStrictEqual(entryMetadata, {
          resource: loggingCommon.resource,
          httpRequest: HTTP_REQUEST,
        });
        assert.deepStrictEqual(data, {
          message: MESSAGE,
          metadata: METADATA,
        });
        done();
      };
      loggingCommon.log(LEVEL, MESSAGE, metadataWithRequest, assert.ifError);
    });

    it('should promote timestamp property to metadata', done => {
      const date = new Date();
      const metadataWithRequest = Object.assign(
        {
          timestamp: date,
        },
        METADATA
      );

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        assert.deepStrictEqual(entryMetadata, {
          resource: loggingCommon.resource,
          timestamp: date,
        });
        assert.deepStrictEqual(data, {
          message: MESSAGE,
          metadata: METADATA,
        });
        done();
      };
      loggingCommon.log(LEVEL, MESSAGE, metadataWithRequest, assert.ifError);
    });

    it('should promote labels from metadata to log entry', done => {
      const LABELS = {labelKey: 'labelValue'};
      const metadataWithLabels = Object.assign({labels: LABELS}, METADATA);

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        assert.deepStrictEqual(entryMetadata, {
          resource: loggingCommon.resource,
          labels: LABELS,
        });
        assert.deepStrictEqual(data, {
          message: MESSAGE,
          metadata: METADATA,
        });
        done();
      };
      loggingCommon.log(LEVEL, MESSAGE, metadataWithLabels, assert.ifError);
    });

    it('should promote prefixed trace properties to metadata', done => {
      const metadataWithTrace = Object.assign({}, METADATA);
      const loggingTraceKey = loggingCommonLib.LOGGING_TRACE_KEY;
      const loggingSpanKey = loggingCommonLib.LOGGING_SPAN_KEY;
      const loggingSampledKey = loggingCommonLib.LOGGING_SAMPLED_KEY;
      // metadataWithTrace does not have index signature.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (metadataWithTrace as any)[loggingTraceKey] = 'trace1';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (metadataWithTrace as any)[loggingSpanKey] = 'span1';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (metadataWithTrace as any)[loggingSampledKey] = '1';

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        assert.deepStrictEqual(entryMetadata, {
          resource: loggingCommon.resource,
          trace: 'trace1',
          spanId: 'span1',
          traceSampled: true,
        });
        assert.deepStrictEqual(data, {
          message: MESSAGE,
          metadata: METADATA,
        });
        done();
      };
      loggingCommon.log(LEVEL, MESSAGE, metadataWithTrace, assert.ifError);
    });

    it('should promote a false traceSampled value to metadata', done => {
      const metadataWithTrace = Object.assign({}, METADATA);
      const loggingSampledKey = loggingCommonLib.LOGGING_SAMPLED_KEY;
      // metadataWithTrace does not have index signature.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (metadataWithTrace as any)[loggingSampledKey] = '0';

      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        assert.deepStrictEqual(entryMetadata, {
          resource: loggingCommon.resource,
          traceSampled: false,
        });
        assert.deepStrictEqual(data, {
          message: MESSAGE,
          metadata: METADATA,
        });
        done();
      };
      loggingCommon.log(LEVEL, MESSAGE, metadataWithTrace, assert.ifError);
    });

    it('should set trace metadata from agent if available', done => {
      const oldTraceAgent = global._google_trace_agent;
      global._google_trace_agent = {
        getCurrentContextId: () => {
          return 'trace1';
        },
        getWriterProjectId: () => {
          return 'project1';
        },
      };
      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        assert.deepStrictEqual(entryMetadata, {
          resource: loggingCommon.resource,
          trace: 'projects/project1/traces/trace1',
        });
        assert.deepStrictEqual(data, {
          message: MESSAGE,
          metadata: METADATA,
        });
        done();
      };

      loggingCommon.log(LEVEL, MESSAGE, METADATA, assert.ifError);

      global._google_trace_agent = oldTraceAgent;
    });

    it('should leave out trace metadata if trace unavailable', () => {
      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        assert.deepStrictEqual(entryMetadata, {
          resource: loggingCommon.resource,
        });
        assert.deepStrictEqual(data, {
          message: MESSAGE,
          metadata: METADATA,
        });
      };

      const oldTraceAgent = global._google_trace_agent;

      global._google_trace_agent = {};
      loggingCommon.log(LEVEL, MESSAGE, METADATA, assert.ifError);

      global._google_trace_agent = {
        getCurrentContextId: () => {
          return null;
        },
        getWriterProjectId: () => {
          return null;
        },
      };
      loggingCommon.log(LEVEL, MESSAGE, METADATA, assert.ifError);

      global._google_trace_agent = {
        getCurrentContextId: () => {
          return null;
        },
        getWriterProjectId: () => {
          return 'project1';
        },
      };
      loggingCommon.log(LEVEL, MESSAGE, METADATA, assert.ifError);

      global._google_trace_agent = {
        getCurrentContextId: () => {
          return 'trace1';
        },
        getWriterProjectId: () => {
          return null;
        },
      };
      loggingCommon.log(LEVEL, MESSAGE, METADATA, assert.ifError);
      global._google_trace_agent = oldTraceAgent;
    });

    it('should write to the log', done => {
      const entry = {};

      loggingCommon.cloudLog.entry = () => {
        return entry;
      };

      loggingCommon.cloudLog[STACKDRIVER_LEVEL] = (
        entry_: Entry[],
        callback: () => void
      ) => {
        assert.deepEqual(entry_[0], entry);
        callback(); // done()
      };

      loggingCommon.log(LEVEL, MESSAGE, METADATA, done);
    });

    it('should add instrumentation log entry', done => {
      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        return new Entry(entryMetadata, data);
      };
      loggingCommon.cloudLog['info'] = (
        entry_: Entry[],
        callback: () => void
      ) => {
        assert.equal(entry_.length, 2);
        assert.equal(
          entry_[1].data[instrumentation.DIAGNOSTIC_INFO_KEY][
            instrumentation.INSTRUMENTATION_SOURCE_KEY
          ][0].name,
          'nodejs-winston'
        );
        callback(); // done()
      };
      instrumentation.setInstrumentationStatus(false);
      loggingCommon.log(INFO, MESSAGE, METADATA, done);
    });

    it('should add instrumentation log entry with info log level', done => {
      loggingCommon.cloudLog.entry = (entryMetadata: {}, data: {}) => {
        return new Entry(entryMetadata, data);
      };
      loggingCommon.cloudLog['info'] = (entry_: Entry[]) => {
        assert.equal(entry_.length, 1);
        assert.equal(
          entry_[0].data[instrumentation.DIAGNOSTIC_INFO_KEY][
            instrumentation.INSTRUMENTATION_SOURCE_KEY
          ][0].name,
          'nodejs-winston'
        );
      };
      loggingCommon.cloudLog[STACKDRIVER_LEVEL] = (entry_: Entry[]) => {
        assert.equal(entry_.length, 1);
        assert.deepStrictEqual(entry_[0].data, {
          message: MESSAGE,
          metadata: METADATA,
        });
      };
      instrumentation.setInstrumentationStatus(false);
      loggingCommon.log(LEVEL, MESSAGE, METADATA);
      done();
    });
  });

  describe('label and labels', () => {
    const LEVEL = Object.keys(OPTIONS.levels as {[name: string]: number})[0];
    const MESSAGE = 'message';
    const PREFIX = 'prefix';
    const LABELS = {label1: 'value1'};
    const METADATA: Metadata = {value: () => {}, labels: {label2: 'value2'}};

    beforeEach(() => {
      const opts = Object.assign({}, OPTIONS, {
        prefix: PREFIX,
        labels: LABELS,
      });

      loggingCommon = new loggingCommonLib.LoggingCommon(opts);
    });

    it('should properly create an entry with labels and [prefix] message', done => {
      loggingCommon.cloudLog.entry = (entryMetadata1: {}, data1: {}) => {
        assert.deepStrictEqual(entryMetadata1, {
          resource: loggingCommon.resource,
          // labels should have been merged.
          labels: {
            label1: 'value1',
            label2: 'value2',
          },
        });
        assert.deepStrictEqual(data1, {
          message: `[${PREFIX}] ${MESSAGE}`,
          metadata: METADATA,
        });

        const metadataWithoutLabels = Object.assign({}, METADATA);
        delete metadataWithoutLabels.labels;

        loggingCommon.cloudLog.entry = (entryMetadata2: {}, data2: {}) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          console.log((entryMetadata2 as any).labels);
          assert.deepStrictEqual(entryMetadata2, {
            resource: loggingCommon.resource,
            labels: {label1: 'value1'},
          });
          assert.deepStrictEqual(data2, {
            message: `[${PREFIX}] ${MESSAGE}`,
            metadata: METADATA,
          });
          done();
        };

        loggingCommon.log(
          LEVEL,
          MESSAGE,
          metadataWithoutLabels,
          assert.ifError
        );
      };

      loggingCommon.log(LEVEL, MESSAGE, METADATA, assert.ifError);
    });
  });
});
