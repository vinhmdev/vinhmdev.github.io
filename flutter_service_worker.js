'use strict';
const MANIFEST = 'flutter-app-manifest';
const TEMP = 'flutter-temp-cache';
const CACHE_NAME = 'flutter-app-cache';

const RESOURCES = {"flutter_bootstrap.js": "08744cc6b44b85f03a6c7983748d8c76",
"version.json": "41e5987ce4e34ffda14fbe9f6cdebcc8",
"splash/img/light-2x.png": "f177bc3f1b5489965ffb628ce6a2bfd3",
"splash/img/dark-4x.png": "3847ba5dcc515089cde14101512e784c",
"splash/img/light-3x.png": "d4e768761d2e254d5a2bb8efba1f0abf",
"splash/img/dark-3x.png": "b1809ca5658771d1d4cb81e90ba4c495",
"splash/img/light-4x.png": "8b3a77394c464442ae69ac67cdb68e22",
"splash/img/dark-2x.png": "3690457a74772fc9320ee5767b7dc659",
"splash/img/dark-1x.png": "f1cd820d104975e225b3615ff25c1568",
"splash/img/light-1x.png": "e75cde72d74714469285ae5f3de76b42",
"index.html": "b719284b614bbad380acff8d782aa10e",
"/": "b719284b614bbad380acff8d782aa10e",
"main.dart.js": "ca81847eff2ecd2a8a7fe9a5ee5ca01e",
"web/assets/images/title_background.jpg": "c0c3627ad3a0d362235e85a614d4faeb",
"web/assets/library/qr_scan_index.min.js": "1a7607b39d06ec9c840231661eb5a695",
"flutter.js": "f393d3c16b631f36852323de8e583132",
"favicon.png": "c5053eb1b82b6fc6a1f3811e8180751a",
"icons/Icon-192.png": "457366150f19da849659754d56d82047",
"icons/Icon-maskable-192.png": "457366150f19da849659754d56d82047",
"icons/Icon-maskable-512.png": "d2a7d1bdd68a819424f1b1d7bec5f830",
"icons/Icon-512.png": "d2a7d1bdd68a819424f1b1d7bec5f830",
"manifest.json": "2c8f8fe7e72b1af862012c426813d86a",
"assets/AssetManifest.json": "26635b1e3673619511e51fb715412d94",
"assets/NOTICES": "dcfbcfb415cc8fd1ef07f9ed182e9c43",
"assets/FontManifest.json": "dc3d03800ccca4601324923c0b1d6d57",
"assets/AssetManifest.bin.json": "316db43d98c68b2163d2319391e6ef37",
"assets/packages/cupertino_icons/assets/CupertinoIcons.ttf": "e986ebe42ef785b27164c36a9abc7818",
"assets/shaders/ink_sparkle.frag": "ecc85a2e95f5e9f53123dcaf8cb9b6ce",
"assets/AssetManifest.bin": "1520518ede99665525f211eb46a9430a",
"assets/fonts/MaterialIcons-Regular.otf": "718f1193b96657d9cc6d4055a1844e9e",
"assets/assets/images/app-icon-light.png": "f7acc716484cf35e8b5b7617cd0df4ef",
"assets/assets/images/logo-dark.png": "b8e42715d2c8bd641a80d23cdc6ea419",
"assets/assets/images/placeholder.png": "ac0bb3de33e6f74cf79df6cd1f3caad8",
"assets/assets/images/404-error.svg": "c4475c587797a64fab60bfd4babada26",
"assets/assets/images/app-icon-dark.png": "3e28301bd2b5b0421676720d0f2fc281",
"assets/assets/images/i-ching/i-ching.png": "3bb91d44634f0fa967cc0316f0dad64e",
"assets/assets/images/logo-light.png": "83100e58502ee6e5b410a7c7c0b07e0e",
"assets/assets/data/data.json": "d41d8cd98f00b204e9800998ecf8427e",
"assets/assets/data/i-ching/vi/64-i-ching/111110.md": "4c75c2a7bc39d482ca3d9902b73314db",
"assets/assets/data/i-ching/vi/64-i-ching/111001.md": "ca214dee8f9d8f4bbadd72f4cdcfd534",
"assets/assets/data/i-ching/vi/64-i-ching/011000.md": "752bea6f98f852446102145174b8aa6e",
"assets/assets/data/i-ching/vi/64-i-ching/011111.md": "d0a5d180f46a8150b928bf01b37f48af",
"assets/assets/data/i-ching/vi/64-i-ching/011101.md": "5d251c990ee839c50a2129b41aa3b27f",
"assets/assets/data/i-ching/vi/64-i-ching/011010.md": "0bc6c920b70597614b789569f6cd1ff0",
"assets/assets/data/i-ching/vi/64-i-ching/111011.md": "6b54208c582a96f447a189a00552adec",
"assets/assets/data/i-ching/vi/64-i-ching/111100.md": "5c04cf8e59805aa94c8abaa3a6a090dd",
"assets/assets/data/i-ching/vi/64-i-ching/111111.md": "2c261b2341991d04321935ea88fdaae2",
"assets/assets/data/i-ching/vi/64-i-ching/111000.md": "8cd5c64fd59a5585f5f423e32060a216",
"assets/assets/data/i-ching/vi/64-i-ching/011001.md": "bbc2260738182f735d61aac6ab470459",
"assets/assets/data/i-ching/vi/64-i-ching/011110.md": "18513fec5f408005a2b7ed088b335568",
"assets/assets/data/i-ching/vi/64-i-ching/011100.md": "627f1477646bfc7c99c310546c45d4a1",
"assets/assets/data/i-ching/vi/64-i-ching/011011.md": "254de2e48c4ac6fdc459d677bc066788",
"assets/assets/data/i-ching/vi/64-i-ching/111010.md": "5ddb9c5e512af325e92d0b87b73d9ecc",
"assets/assets/data/i-ching/vi/64-i-ching/111101.md": "22d9d00b38fa7da052d56dd9bf65f85c",
"assets/assets/data/i-ching/vi/64-i-ching/010000.md": "d7241027f0835ea64ec8fdfb31d2f5c1",
"assets/assets/data/i-ching/vi/64-i-ching/010111.md": "e3082896ca2145461d53693875c7d0f4",
"assets/assets/data/i-ching/vi/64-i-ching/110110.md": "b6fc0dd51f9281456ce7daf67959de2d",
"assets/assets/data/i-ching/vi/64-i-ching/110001.md": "a4535dc0306ed0090b8db2b81941fb8f",
"assets/assets/data/i-ching/vi/64-i-ching/110011.md": "32a821c64ea1240bccaac9fc108630fd",
"assets/assets/data/i-ching/vi/64-i-ching/110100.md": "456a8b37fb64f266a59965eaa0020952",
"assets/assets/data/i-ching/vi/64-i-ching/010101.md": "72bf1bb67f743ae8ab0451ba5c0bba8f",
"assets/assets/data/i-ching/vi/64-i-ching/010010.md": "556c68bf32b679a557a3497aff45d38f",
"assets/assets/data/i-ching/vi/64-i-ching/010001.md": "17c919c327eaa9cf1014d056a53b1e6d",
"assets/assets/data/i-ching/vi/64-i-ching/010110.md": "ff92dc2156f3804001a89d223584531c",
"assets/assets/data/i-ching/vi/64-i-ching/110111.md": "905a9746764a9fb7943bf4f23f8bc58b",
"assets/assets/data/i-ching/vi/64-i-ching/110000.md": "f99e959898e4c7298bc8e1ab14f4d8dc",
"assets/assets/data/i-ching/vi/64-i-ching/110010.md": "6d39282e2669624b157a2012cbda1e52",
"assets/assets/data/i-ching/vi/64-i-ching/110101.md": "97ca58ff9521fb3fec871874a64f822a",
"assets/assets/data/i-ching/vi/64-i-ching/010100.md": "d634dd927cf73198a5a8cebbaf72c5dd",
"assets/assets/data/i-ching/vi/64-i-ching/010011.md": "7360c2f598c7cad7c5674917d7393faf",
"assets/assets/data/i-ching/vi/64-i-ching/101011.md": "8e21b16fc2d0f7a72032363f9d385d8b",
"assets/assets/data/i-ching/vi/64-i-ching/101100.md": "1b84395184f56073ad34fcdf4cc973eb",
"assets/assets/data/i-ching/vi/64-i-ching/001101.md": "76b267b67b3158e9b8cab190a1c51fa7",
"assets/assets/data/i-ching/vi/64-i-ching/001010.md": "9fabd8473696d50fd5c7f0a306b10419",
"assets/assets/data/i-ching/vi/64-i-ching/001000.md": "de63b6a2ee788439ee079313be216337",
"assets/assets/data/i-ching/vi/64-i-ching/001111.md": "93b33658cc80b6ddbfdebe940b232977",
"assets/assets/data/i-ching/vi/64-i-ching/101110.md": "6f94acd956fabee99c79bca95283c895",
"assets/assets/data/i-ching/vi/64-i-ching/101001.md": "56a12b18847cd55e93b248bc0e54d1bc",
"assets/assets/data/i-ching/vi/64-i-ching/101010.md": "a41812780412e4c479b88421b40da200",
"assets/assets/data/i-ching/vi/64-i-ching/101101.md": "f5bd388c71074f8a568f9c05901232cd",
"assets/assets/data/i-ching/vi/64-i-ching/001100.md": "ab8a0db88d4a027c1078d5a8a8b94a2a",
"assets/assets/data/i-ching/vi/64-i-ching/001011.md": "5af0d4ddfdd095b468cf119068e7dd09",
"assets/assets/data/i-ching/vi/64-i-ching/001001.md": "4e65216a4067df3f71cec55916f320d1",
"assets/assets/data/i-ching/vi/64-i-ching/001110.md": "af662442bb446ccda02aaaa5e6d3926b",
"assets/assets/data/i-ching/vi/64-i-ching/101111.md": "87b43b26563716be12ad7ba53393c79c",
"assets/assets/data/i-ching/vi/64-i-ching/101000.md": "7500a0fb5fafddb860c2b89238b76da2",
"assets/assets/data/i-ching/vi/64-i-ching/000101.md": "35242f5b25840d316ba3f0c43a274219",
"assets/assets/data/i-ching/vi/64-i-ching/000010.md": "b1e8320947311984dbccff15f85582dc",
"assets/assets/data/i-ching/vi/64-i-ching/100011.md": "9f9d2cb03a8d3a48494db68af107a377",
"assets/assets/data/i-ching/vi/64-i-ching/100100.md": "89cc5327b90cb072cf062f237bd33a31",
"assets/assets/data/i-ching/vi/64-i-ching/100110.md": "007b2451bf5ea9b354e02ba219bc14f3",
"assets/assets/data/i-ching/vi/64-i-ching/100001.md": "ba1c985402c5dc8759e342abebffe9d2",
"assets/assets/data/i-ching/vi/64-i-ching/000000.md": "df7e562f621b8fe01c67de5693536933",
"assets/assets/data/i-ching/vi/64-i-ching/000111.md": "b106488df86f9ce2695a38f9f5ce124a",
"assets/assets/data/i-ching/vi/64-i-ching/000100.md": "482be548dad51471aa08b75985069182",
"assets/assets/data/i-ching/vi/64-i-ching/000011.md": "c6800f1871dd097ba2333cf72de628fc",
"assets/assets/data/i-ching/vi/64-i-ching/100010.md": "1366282b1b72a6a8a4761e78093d55e8",
"assets/assets/data/i-ching/vi/64-i-ching/100101.md": "7ef79f1179b764a041e2c7114ab2ad55",
"assets/assets/data/i-ching/vi/64-i-ching/100111.md": "2e321b6d1289f893234fa7c485d87ea6",
"assets/assets/data/i-ching/vi/64-i-ching/100000.md": "929b8c44a1bea7b79c8ba81e81ea8929",
"assets/assets/data/i-ching/vi/64-i-ching/000001.md": "472594433a315b967e4ddc17f49c41d4",
"assets/assets/data/i-ching/vi/64-i-ching/000110.md": "8d4656a04300e2518ae407ef6d1ebe7a",
"assets/assets/data/i-ching/i-ching.json": "62588ac0cd67be5af81237ca0ac7d1fc",
"assets/assets/translations/en.json": "1c1e061f9c533d06ae7f4cf7f86359ce",
"assets/assets/translations/vi.json": "3d29a75fcf0ed7dfff86d3db8f92fc69",
"canvaskit/skwasm.js": "694fda5704053957c2594de355805228",
"canvaskit/skwasm.js.symbols": "262f4827a1317abb59d71d6c587a93e2",
"canvaskit/canvaskit.js.symbols": "48c83a2ce573d9692e8d970e288d75f7",
"canvaskit/skwasm.wasm": "9f0c0c02b82a910d12ce0543ec130e60",
"canvaskit/chromium/canvaskit.js.symbols": "a012ed99ccba193cf96bb2643003f6fc",
"canvaskit/chromium/canvaskit.js": "671c6b4f8fcc199dcc551c7bb125f239",
"canvaskit/chromium/canvaskit.wasm": "b1ac05b29c127d86df4bcfbf50dd902a",
"canvaskit/canvaskit.js": "66177750aff65a66cb07bb44b8c6422b",
"canvaskit/canvaskit.wasm": "1f237a213d7370cf95f443d896176460",
"canvaskit/skwasm.worker.js": "89990e8c92bcb123999aa81f7e203b1c"};
// The application shell files that are downloaded before a service worker can
// start.
const CORE = ["main.dart.js",
"index.html",
"flutter_bootstrap.js",
"assets/AssetManifest.bin.json",
"assets/FontManifest.json"];

// During install, the TEMP cache is populated with the application shell files.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  return event.waitUntil(
    caches.open(TEMP).then((cache) => {
      return cache.addAll(
        CORE.map((value) => new Request(value, {'cache': 'reload'})));
    })
  );
});
// During activate, the cache is populated with the temp files downloaded in
// install. If this service worker is upgrading from one with a saved
// MANIFEST, then use this to retain unchanged resource files.
self.addEventListener("activate", function(event) {
  return event.waitUntil(async function() {
    try {
      var contentCache = await caches.open(CACHE_NAME);
      var tempCache = await caches.open(TEMP);
      var manifestCache = await caches.open(MANIFEST);
      var manifest = await manifestCache.match('manifest');
      // When there is no prior manifest, clear the entire cache.
      if (!manifest) {
        await caches.delete(CACHE_NAME);
        contentCache = await caches.open(CACHE_NAME);
        for (var request of await tempCache.keys()) {
          var response = await tempCache.match(request);
          await contentCache.put(request, response);
        }
        await caches.delete(TEMP);
        // Save the manifest to make future upgrades efficient.
        await manifestCache.put('manifest', new Response(JSON.stringify(RESOURCES)));
        // Claim client to enable caching on first launch
        self.clients.claim();
        return;
      }
      var oldManifest = await manifest.json();
      var origin = self.location.origin;
      for (var request of await contentCache.keys()) {
        var key = request.url.substring(origin.length + 1);
        if (key == "") {
          key = "/";
        }
        // If a resource from the old manifest is not in the new cache, or if
        // the MD5 sum has changed, delete it. Otherwise the resource is left
        // in the cache and can be reused by the new service worker.
        if (!RESOURCES[key] || RESOURCES[key] != oldManifest[key]) {
          await contentCache.delete(request);
        }
      }
      // Populate the cache with the app shell TEMP files, potentially overwriting
      // cache files preserved above.
      for (var request of await tempCache.keys()) {
        var response = await tempCache.match(request);
        await contentCache.put(request, response);
      }
      await caches.delete(TEMP);
      // Save the manifest to make future upgrades efficient.
      await manifestCache.put('manifest', new Response(JSON.stringify(RESOURCES)));
      // Claim client to enable caching on first launch
      self.clients.claim();
      return;
    } catch (err) {
      // On an unhandled exception the state of the cache cannot be guaranteed.
      console.error('Failed to upgrade service worker: ' + err);
      await caches.delete(CACHE_NAME);
      await caches.delete(TEMP);
      await caches.delete(MANIFEST);
    }
  }());
});
// The fetch handler redirects requests for RESOURCE files to the service
// worker cache.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  var origin = self.location.origin;
  var key = event.request.url.substring(origin.length + 1);
  // Redirect URLs to the index.html
  if (key.indexOf('?v=') != -1) {
    key = key.split('?v=')[0];
  }
  if (event.request.url == origin || event.request.url.startsWith(origin + '/#') || key == '') {
    key = '/';
  }
  // If the URL is not the RESOURCE list then return to signal that the
  // browser should take over.
  if (!RESOURCES[key]) {
    return;
  }
  // If the URL is the index.html, perform an online-first request.
  if (key == '/') {
    return onlineFirst(event);
  }
  event.respondWith(caches.open(CACHE_NAME)
    .then((cache) =>  {
      return cache.match(event.request).then((response) => {
        // Either respond with the cached resource, or perform a fetch and
        // lazily populate the cache only if the resource was successfully fetched.
        return response || fetch(event.request).then((response) => {
          if (response && Boolean(response.ok)) {
            cache.put(event.request, response.clone());
          }
          return response;
        });
      })
    })
  );
});
self.addEventListener('message', (event) => {
  // SkipWaiting can be used to immediately activate a waiting service worker.
  // This will also require a page refresh triggered by the main worker.
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
    return;
  }
  if (event.data === 'downloadOffline') {
    downloadOffline();
    return;
  }
});
// Download offline will check the RESOURCES for all files not in the cache
// and populate them.
async function downloadOffline() {
  var resources = [];
  var contentCache = await caches.open(CACHE_NAME);
  var currentContent = {};
  for (var request of await contentCache.keys()) {
    var key = request.url.substring(origin.length + 1);
    if (key == "") {
      key = "/";
    }
    currentContent[key] = true;
  }
  for (var resourceKey of Object.keys(RESOURCES)) {
    if (!currentContent[resourceKey]) {
      resources.push(resourceKey);
    }
  }
  return contentCache.addAll(resources);
}
// Attempt to download the resource online before falling back to
// the offline cache.
function onlineFirst(event) {
  return event.respondWith(
    fetch(event.request).then((response) => {
      return caches.open(CACHE_NAME).then((cache) => {
        cache.put(event.request, response.clone());
        return response;
      });
    }).catch((error) => {
      return caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          if (response != null) {
            return response;
          }
          throw error;
        });
      });
    })
  );
}
