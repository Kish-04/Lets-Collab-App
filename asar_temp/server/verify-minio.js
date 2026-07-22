require('dotenv').config();
const mongoose = require('mongoose');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

(async () => {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect('mongodb://localhost:27017/ircp_db');
    const Alert = require('./alert');
    const latestAlert = await Alert.findOne({ message: /Evidence saved/ }).sort({ createdAt: -1 });
    console.log("\n--- Latest MongoDB Alert Record ---");
    console.log(latestAlert ? latestAlert : "No evidence alert found.");

    console.log("\nConnecting to MinIO...");
    const s3 = new S3Client({
      region: 'us-east-1',
      credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
      endpoint: 'http://localhost:9000',
      forcePathStyle: true,
    });
    
    const command = new ListObjectsV2Command({ Bucket: 'ircp-evidence-bucket', Prefix: 'evidence/' });
    const data = await s3.send(command);
    console.log("\n--- MinIO Bucket Contents ---");
    if (data.Contents && data.Contents.length > 0) {
      data.Contents.forEach(item => {
        console.log(`- ${item.Key} (${item.Size} bytes)`);
      });
    } else {
      console.log("Bucket is empty.");
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    mongoose.disconnect();
  }
})();
