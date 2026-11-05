# DSMG4EVA Android app: install guide

The app is a lightweight wrapper around the live dashboard at
https://3mbr4ce.github.io/dsmg4eva/. It always shows the latest data, so you never need to update the app when the site changes.

**File:** `DSMG4EVA-1.0.apk` (about 1.1 MB, Android 7.0 or newer)

## 1. Get the APK onto your phone
Pick one:
- **Easiest:** send the file to yourself (Telegram, Discord, WhatsApp "Saved messages", e-mail, Google Drive) and open it on the phone.
- **USB:** copy it into the phone's `Download` folder.
- **Share a link with friends (optional):** in your GitHub repo, open **Releases → Draft a new release**, tag it `v1.0`, attach `DSMG4EVA-1.0.apk`, and publish. Friends download it from the release page.
  (Don't put the APK in the `docs/` folder. It works, but it bloats every Pages deploy.)

## 2. Allow installing from that app
Android blocks APKs that don't come from the Play Store, so you have to allow it once:
1. Tap the APK in Files / Downloads / the chat app.
2. Android says *"For your security, your phone is not allowed to install unknown apps from this source"*. Tap **Settings**.
3. Turn on **Allow from this source**, then go back.
   (Or set it up first: Settings → Apps → Special app access → **Install unknown apps** → pick your Files/browser/chat app → Allow.)
4. Tap **Install**.

## 3. Play Protect warning (normal)
Google Play Protect may show **"Unsafe app blocked"** or **"App scanned / unknown developer"**, because the app isn't from the Play Store and Google doesn't know the signing key.
- Tap **More details → Install anyway**. On some phones it's **Install without scanning**.
- If it offers to *"Send app for scanning"*, you can choose either option.

The app only needs Internet access. It doesn't ask for any other permissions.

## 4. Using it
- **Pull down** at the top of the page to refresh.
- The **Back** button closes the gear sheet or goes back. At the start page, it exits the app.
- Links to other sites (for example the Armory) open in your normal browser.
- **No internet?** You'll see an offline screen with a **Retry** button.
- Works in portrait and landscape.

## Updating the app later
Build the new version with a **higher `versionCode`** and sign it with the **same keystore**
(`apk/keystore/dsmg4eva-release.jks`). Android only installs an update over the old app if both are signed with the same key.
**Back up the keystore folder.** If you lose it, friends have to uninstall the app before they can install a new build.
To rebuild, run `./gradlew assembleRelease` in `apk/project/` (needs JDK 17 and the Android SDK, and reads `../keystore/keystore.properties`).
