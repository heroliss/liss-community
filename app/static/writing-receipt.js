(function () {
  'use strict';
  // Receipts are emitted only after a committed save. Match the exact version
  // submitted, so a response in one tab cannot erase newer work in another.
  var receipt = document.currentScript;
  if (receipt && receipt.dataset.writingReceiptToken) {
    var key = 'liss-writing-draft:v1:' + [receipt.dataset.writingReceiptOwner,
      receipt.dataset.writingReceiptScope, 'body'].map(encodeURIComponent).join(':');
    try {
      var saved = JSON.parse(localStorage.getItem(key));
      if (saved && saved.version === 1 && saved.token === receipt.dataset.writingReceiptToken) {
        localStorage.removeItem(key);
      }
    } catch (error) {} // Storage may be blocked or contain a malformed record.
  }
}());
