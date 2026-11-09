`update-fixtures.json` exercises the production native update parser with
RSA3072/SHA256 signatures. The embedded public key belongs only to these test
vectors; its ephemeral private key was discarded and is unrelated to either
commission's production signing certificate.

The valid catalog uses FPV artifact names. Malformed-field vectors have valid
signatures so they exercise field validation, while the payload, signature and
truncation vectors retain deliberately invalid signatures. A signed catalog with
the other commission's artifact names must also be rejected. Both
`update_protocol.py` and `deep-native-fuzz.py` verify these vectors against the
actual native parser.
