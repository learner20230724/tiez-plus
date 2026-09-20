const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
module.exports = function withPlusDiscovery(config) {
  config = withMainApplication(config, c => {
    if (!c.modResults.contents.includes('PlusDiscoveryPackage()')) {
      c.modResults.contents = c.modResults.contents.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n              add(PlusDiscoveryPackage())');
    }
    return c;
  });
  return withDangerousMod(config, ['android', async c => {
    const name = c.android.package;
    const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/java', name.replaceAll('.', '/'));
    fs.mkdirSync(dir, { recursive: true });
    const source = fs.readFileSync(path.join(__dirname, 'native/PlusDiscovery.kt'), 'utf8').replaceAll('__PACKAGE__', name);
    fs.writeFileSync(path.join(dir, 'PlusDiscovery.kt'), source);
    return c;
  }]);
};
