const express = require("express");
const bodyParser = require("body-parser");
const vmController = require('./src/virtual-machine/controllers');
const imageController = require('./src/images/controllers');
const networkController = require('./src/networks/controllers');
const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use('/vm', vmController);
app.use('/image', imageController);
app.use('/network', networkController);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
