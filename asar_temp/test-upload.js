const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

(async () => {
  const form = new FormData();
  form.append('room', 'TESTROOM');
  form.append('evidenceFile', Buffer.from('fake image data'), {
    filename: 'test.png',
    contentType: 'image/png',
  });

  try {
    const res = await fetch('http://localhost:3001/api/admin/upload-evidence', {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    console.log(data);
  } catch (err) {
    console.error(err);
  }
})();
