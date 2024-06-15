'use strict';
const MANIFEST = 'flutter-app-manifest';
const TEMP = 'flutter-temp-cache';
const CACHE_NAME = 'flutter-app-cache';

const RESOURCES = {"assets/AssetManifest.bin": "1cbcd8f5507c19327b095a8beb50bce6",
"assets/AssetManifest.bin.json": "f0da3a4195a40a7de317049c60c99fec",
"assets/AssetManifest.json": "2d18581aa717d57478c9270593dd5fc6",
"assets/assets/data/address.json": "32bfa137b5e81f0545443d1dcafab78b",
"assets/assets/data/bague.json": "24226f668a09bcbd434ff65d51a2c956",
"assets/assets/data/i_ching.json": "4381b06e2dbbc4aff300561ec8adbb43",
"assets/assets/data/vi/64_i_ching/000000.md": "e645a07ab38fe38e218fcd66cb90dbbe",
"assets/assets/data/vi/64_i_ching/000001.md": "a72a0c519d15d2facaf5aae72569d653",
"assets/assets/data/vi/64_i_ching/000010.md": "a136a3d311f82153a359447177bb6c2c",
"assets/assets/data/vi/64_i_ching/000011.md": "9ddc14a01c296cbe6cb6eb064e20bd1f",
"assets/assets/data/vi/64_i_ching/000100.md": "8931f0c7495de98b6be60e7638b86a43",
"assets/assets/data/vi/64_i_ching/000101.md": "89dd5e0449f157af6c4bedcee487f8be",
"assets/assets/data/vi/64_i_ching/000110.md": "b734246fdb2492136f6a589432ea82b4",
"assets/assets/data/vi/64_i_ching/000111.md": "1b60d9241f5cf21342d71ef726455441",
"assets/assets/data/vi/64_i_ching/001000.md": "25dbf5ba13d2af845dc9ea8945fd6a21",
"assets/assets/data/vi/64_i_ching/001001.md": "04bb9995d8fbf944d231a11cd89022c3",
"assets/assets/data/vi/64_i_ching/001010.md": "dbd3b7dfbd8471082ae5ceb119b2724d",
"assets/assets/data/vi/64_i_ching/001011.md": "aba2cedea8ce8576ab2b38c616f99c90",
"assets/assets/data/vi/64_i_ching/001100.md": "7e1da05acece74984109e102e54934b8",
"assets/assets/data/vi/64_i_ching/001101.md": "dc54148500ef385247003e8e00397271",
"assets/assets/data/vi/64_i_ching/001110.md": "e73dee687dfa03fab51ade99d46d167c",
"assets/assets/data/vi/64_i_ching/001111.md": "4d345b99fa78ac9668989132dd1130b1",
"assets/assets/data/vi/64_i_ching/010000.md": "7bd4affad81c84975bb17955d684c5e8",
"assets/assets/data/vi/64_i_ching/010001.md": "041b9ca4ebe4dcb8c938b8b717c9a4db",
"assets/assets/data/vi/64_i_ching/010010.md": "98092baa04adc1405f98cb7a1168fb18",
"assets/assets/data/vi/64_i_ching/010011.md": "e5e06b9a89ce4961fab4a5c77d573ba2",
"assets/assets/data/vi/64_i_ching/010100.md": "bf7a787befc7b9d67427e05a26819de9",
"assets/assets/data/vi/64_i_ching/010101.md": "acd90eb7662d44bd03337ca201a56735",
"assets/assets/data/vi/64_i_ching/010110.md": "f71ac5639e17a590afda983c3400e823",
"assets/assets/data/vi/64_i_ching/010111.md": "ded1cbed187fd49905278af3705e8ed4",
"assets/assets/data/vi/64_i_ching/011000.md": "7c2ac8658f72a59bb8ed511e777f9c87",
"assets/assets/data/vi/64_i_ching/011001.md": "a8bf4ab36f3d3db81416457383ca1363",
"assets/assets/data/vi/64_i_ching/011010.md": "97be28b6d97d2b4259018720987132aa",
"assets/assets/data/vi/64_i_ching/011011.md": "8fce4c9695e484819311ab5637f8c401",
"assets/assets/data/vi/64_i_ching/011100.md": "466e2a22624d097f53fa5384718d16d5",
"assets/assets/data/vi/64_i_ching/011101.md": "eb10c1d9c8544544df8b38aea1bd1811",
"assets/assets/data/vi/64_i_ching/011110.md": "2a35b3210ed807258ba5a34384dbc9dd",
"assets/assets/data/vi/64_i_ching/011111.md": "41b42017b9feeeda9a738c33eb582ba7",
"assets/assets/data/vi/64_i_ching/100000.md": "864583429fb64409abf32b76e4bca615",
"assets/assets/data/vi/64_i_ching/100001.md": "abe99f7008a9e654746083acec13e318",
"assets/assets/data/vi/64_i_ching/100010.md": "7fc21c33a599158245d1bcb354c26b8d",
"assets/assets/data/vi/64_i_ching/100011.md": "a1184374c754e01841c224bf41625a83",
"assets/assets/data/vi/64_i_ching/100100.md": "39ca738ee7f5d4db0bbbd082e9d69b57",
"assets/assets/data/vi/64_i_ching/100101.md": "aef0d4cb25d69507108db2973da45231",
"assets/assets/data/vi/64_i_ching/100110.md": "4174d03270bfcdae3d6e12e9b3c837b4",
"assets/assets/data/vi/64_i_ching/100111.md": "c6138d5a5d06b300fa6b2a28b1bc0955",
"assets/assets/data/vi/64_i_ching/101000.md": "f22c6da2ad3b32af8b77054ce4ae8480",
"assets/assets/data/vi/64_i_ching/101001.md": "60c535709410d7944be01dddafaeabed",
"assets/assets/data/vi/64_i_ching/101010.md": "8c4e9d5ac6c15ab19263cca6672dab76",
"assets/assets/data/vi/64_i_ching/101011.md": "798839c16abe7b3e272385d36fd344fa",
"assets/assets/data/vi/64_i_ching/101100.md": "425293dd1ce8debf98161338ad00340c",
"assets/assets/data/vi/64_i_ching/101101.md": "0cfd369cb0ec0538636d250b0caf2fdb",
"assets/assets/data/vi/64_i_ching/101110.md": "35a619b9c7d4c16b42990d0363d6ca14",
"assets/assets/data/vi/64_i_ching/101111.md": "e505851140b5bfc02eb9bde0f793d73d",
"assets/assets/data/vi/64_i_ching/110000.md": "7b2bcfd02be095e9b577a0f7fd86d6aa",
"assets/assets/data/vi/64_i_ching/110001.md": "3640a3b3c110395f2b2fea83b287a1a6",
"assets/assets/data/vi/64_i_ching/110010.md": "328d10f8253f11a0dd09675392c6a2a1",
"assets/assets/data/vi/64_i_ching/110011.md": "dc6ad9b81b2621ec87b8581675cd5128",
"assets/assets/data/vi/64_i_ching/110100.md": "2ab2f94c7a8e9736fe7013a2c843aa9c",
"assets/assets/data/vi/64_i_ching/110101.md": "7675be962a9b4aa2a0c3772ccfcc031e",
"assets/assets/data/vi/64_i_ching/110110.md": "335bdf5e2a372c13b2acf07b430fe631",
"assets/assets/data/vi/64_i_ching/110111.md": "858c3cba5c27dbf0dd63db677be5cf26",
"assets/assets/data/vi/64_i_ching/111000.md": "5226865e1bbda0003438cc99030357f5",
"assets/assets/data/vi/64_i_ching/111001.md": "4538a33462d6c2a72244fe8c46a7bc56",
"assets/assets/data/vi/64_i_ching/111010.md": "3e30e110de447fe1b0091671039aaa62",
"assets/assets/data/vi/64_i_ching/111011.md": "f2c9fd43057c78932080c73cb8c7fa06",
"assets/assets/data/vi/64_i_ching/111100.md": "cda5e46fd06b1eaae514fae73c243557",
"assets/assets/data/vi/64_i_ching/111101.md": "fb42e3f4404d84be1ff4d08e9c19f210",
"assets/assets/data/vi/64_i_ching/111110.md": "21b6eff3010d3341e0641dc206921b39",
"assets/assets/data/vi/64_i_ching/111111.md": "0555fa49f1f74323771556a7074488dc",
"assets/assets/images/branch-color.png": "2399225bfb7c9c3700e5862cec04cdea",
"assets/assets/images/branch-white.png": "55a31ba6091bf28a35007c16a53c7096",
"assets/assets/images/placeholder.png": "db47f49764246cec9de33e84102e4a48",
"assets/assets/translations/en.json": "0d7f7b6d652f292edf8c1251a8521f1f",
"assets/assets/translations/vi.json": "73792b9af3fc811b105441cc773526b1",
"assets/FontManifest.json": "dc3d03800ccca4601324923c0b1d6d57",
"assets/fonts/MaterialIcons-Regular.otf": "dde8708d9f895ade1e1c24a03ec583b6",
"assets/NOTICES": "51308bbda4d89b6d6c32fa902233cc59",
"assets/packages/cupertino_icons/assets/CupertinoIcons.ttf": "e986ebe42ef785b27164c36a9abc7818",
"assets/shaders/ink_sparkle.frag": "ecc85a2e95f5e9f53123dcaf8cb9b6ce",
"canvaskit/canvaskit.js": "738255d00768497e86aa4ca510cce1e1",
"canvaskit/canvaskit.js.symbols": "74a84c23f5ada42fe063514c587968c6",
"canvaskit/canvaskit.wasm": "9251bb81ae8464c4df3b072f84aa969b",
"canvaskit/chromium/canvaskit.js": "901bb9e28fac643b7da75ecfd3339f3f",
"canvaskit/chromium/canvaskit.js.symbols": "ee7e331f7f5bbf5ec937737542112372",
"canvaskit/chromium/canvaskit.wasm": "399e2344480862e2dfa26f12fa5891d7",
"canvaskit/skwasm.js": "5d4f9263ec93efeb022bb14a3881d240",
"canvaskit/skwasm.js.symbols": "c3c05bd50bdf59da8626bbe446ce65a3",
"canvaskit/skwasm.wasm": "4051bfc27ba29bf420d17aa0c3a98bce",
"canvaskit/skwasm.worker.js": "bfb704a6c714a75da9ef320991e88b03",
"favicon.png": "5dcef449791fa27946b3d35ad8803796",
"flutter.js": "383e55f7f3cce5be08fcf1f3881f585c",
"flutter_bootstrap.js": "63357082ab58bbb366bdbbc900bfd3bf",
"icons/Icon-192.png": "ac9a721a12bbc803b44f645561ecb1e1",
"icons/Icon-512.png": "96e752610906ba2a93c65f8abe1645f1",
"icons/Icon-maskable-192.png": "c457ef57daa1d16f64b27b786ec2ea3c",
"icons/Icon-maskable-512.png": "301a7604d45b3e739efc881eb04896ea",
"index.html": "a61a45bd154a9899824bf272e1260970",
"/": "a61a45bd154a9899824bf272e1260970",
"main.dart.js": "fd92420fa83dee254a147c0902c34312",
"manifest.json": "9fa803939706914328105eadbdfac513",
"version.json": "64516255a29d460555cc407a678d8e8d"};
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
