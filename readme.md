# Express middleware for php-fpm
Express middleware for handling php requests and serve static files.

It can be used as replacement for Apache and avoid proxy practice.

It's working seamlessly with WordPress, Joomla, Drupal!

**In order to run the middleware be sure that you have a running php-fpm server**.  
[What is php-fpm?](http://fastjoomlahost.com/mod_php-fastcgi-php-fpm-server)
[Why php-fpm?](http://serverfault.com/a/645765/393463)
How to install php-fpm on
[Windows](http://stackoverflow.com/questions/4539670/php-fpm-for-windows),
[Mac](https://developerjack.com/blog/2016/08/26/Installing-PHP71-with-homebrew/),
[Linux](https://www.google.com/search?q=how+to+install+php-fpm+on+linux)?

[<img src="https://i.imgur.com/NuBnRsT.jpg" alt="how to video" width="560" height="315"/>](http://youtu.be/gqKaZO9epHM)

## Usage & Example
``` bash
npm i express-php-fpm
```
``` js
const express = require('express')
const epf = require('express-php-fpm') 

const options = {
  // root of your php files
  documentRoot: __dirname + '/php_files',
  
  // extra env variables
  env: {},
  
  // connection to your php-fpm server
  // https://nodejs.org/api/net.html#net_socket_connect_options_connectlistener
  socketOptions: { port: 9000 },
}

const app = express()
app.use('/', epf(options)) 
app.listen(3000)

```

## Author
Software was created in January 2017 by [Pravdomil.com](https://pravdomil.com).
You can [buy a beer for him](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=BCL2X3AFQBAP2&item_name=express-php-fpm%20Beer).
