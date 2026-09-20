const { withAppBuildGradle } = require('@expo/config-plugins');
module.exports = config => withAppBuildGradle(config, c => {
  // No hard-coded key, password or upstream signing identity. Debug builds remain development-only.
  const marker = 'signingConfigs {';
  if (!c.modResults.contents.includes('TIEZ_PLUS_KEYSTORE')) {
    c.modResults.contents = c.modResults.contents.replace(marker, `${marker}
        plusRelease {
            if (System.getenv('TIEZ_PLUS_KEYSTORE')) {
                storeFile file(System.getenv('TIEZ_PLUS_KEYSTORE'))
                storePassword System.getenv('TIEZ_PLUS_STORE_PASSWORD')
                keyAlias 'tiez-plus'
                keyPassword System.getenv('TIEZ_PLUS_STORE_PASSWORD')
            }
        }`);
    c.modResults.contents = c.modResults.contents.replace(/(release\s*\{[\s\S]*?)signingConfig signingConfigs.debug/, '$1signingConfig signingConfigs.plusRelease');
  }
  return c;
});
