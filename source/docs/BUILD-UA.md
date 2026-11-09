# Збирання ПК і підпис

Linux x86-64: Python 3, Pillow 12.3.0, GCC, GNU binutils з i386pep.
Для перевірок логіки — Node.js. Для перевірки RSA — OpenSSL development files.

Розпакуйте архів коду в окрему папку. Команди виконуйте там, де лежить build_windows.py:

```bash
python3 -m venv ../.venv-build
source ../.venv-build/bin/activate
python -m pip install Pillow==12.3.0 cryptography==50.0.2 openpyxl==3.1.5
python build_windows.py
npm test
python tests/update_native.py
python tests/update_channel.py
python tests/validate_pe.py
```

Узгоджуйте version/versionCode у package.json, APP_VERSION у web/core.js
та PC_VERSION_NAME/PC_VERSION_CODE у native/update_protocol.h.
EXE має постійну назву FPV-Komisiia-PC.exe.
Кореневу build можна створити повторно. web/vendor/pdfjs/build необхідний.

Для майбутнього підписаного випуску потрібен оригінальний ключ з окремого
приватного резерву власника.
Там потрібні signing/fpv-release.jks і файли паролів. Для збирання використовуйте
поточний вихідний код з цього комплекту. Резервний JKS фактично має формат
PKCS12 і читається цим скриптом без конвертації.

```bash
python release-tools/publish_updates.py   --windows-exe build/FPV-Komisiia-PC.exe --windows-code 150 --windows-name 1.2.27   --catalog-reference release-tools/catalog-reference.json   --pkcs12 /private/fpv-release.jks --password-file /private/storepass.txt   --output /path/clean-public-directory --icon web/icon.png
python tests/update_protocol.py /path/clean-public-directory
```

Для наступного нового випуску номери змінюються. Приватні файли тримайте
поза кодом і каталогом публікації. Сертифікат перевіряється скриптом.

Не додавайте його, ключ або паролі до публічних файлів.
