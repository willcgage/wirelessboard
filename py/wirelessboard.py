import threading
import time


import config
import tornado_server
import shure
import discover


def main():
    init_config = getattr(config, "init_config", None)
    if callable(init_config):
        init_config()
    else:
        init_fn = getattr(config, "init", None)
        if callable(init_fn):
            init_fn()

    time.sleep(.1)
    rxquery_t = threading.Thread(target=shure.WirelessQueryQueue)
    rxcom_t = threading.Thread(target=shure.SocketService)
    web_t = threading.Thread(target=tornado_server.twisted)
    discover_t = threading.Thread(target=discover.discover)
    rxparse_t = threading.Thread(target=shure.ProcessRXMessageQueue)

    rxquery_t.start()
    rxcom_t.start()
    web_t.start()
    discover_t.start()
    rxparse_t.start()

    # Wait here rather than returning. The threads above are non-daemon, so the
    # process stayed alive either way -- but a main thread that finishes runs
    # the handlers registered with threading._register_atexit, one of which is
    # concurrent.futures' own. That sets a module-global shutdown flag, and
    # every thread pool in the process refuses work from then on with
    # "cannot schedule new futures after interpreter shutdown" -- including the
    # executor the config save now hands its slow work to. Signals are also
    # delivered to the main thread, so keeping it alive is what lets Ctrl-C be
    # noticed at all.
    web_t.join()


if __name__ == '__main__':
    main()
