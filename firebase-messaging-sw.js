// Please see this file for the latest firebase-js-sdk version:
// https://github.com/firebase/flutterfire/blob/master/packages/firebase_core/firebase_core_web/lib/src/firebase_sdk_version.dart
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: 'AIzaSyCKbac7w7kGBhFJpecwn6AUBbVY0ZMjBZI',
  appId: '1:1004880980212:web:27f08fba06570e014916a1',
  messagingSenderId: '1004880980212',
  projectId: 'vinh-mdev',
  authDomain: 'vinh-mdev.firebaseapp.com',
  databaseURL: 'https://vinh-mdev-default-rtdb.asia-southeast1.firebasedatabase.app',
  storageBucket: 'vinh-mdev.firebasestorage.app',
  measurementId: 'G-MV949BW73X',
});

const messaging = firebase.messaging();
