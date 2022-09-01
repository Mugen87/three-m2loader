# three-m2loader

### M2 Loader for three.js

`three-m2loader` allows you to import M2 assets from World of Warcraft into your `three.js` app.

| druidcat2.m2  | 7ne_druid_worktable02.m2 | gilneas_fountain01.m2 |
| ------------- | ------------- | ------------- |
| <img width="831" alt="image" src="https://user-images.githubusercontent.com/12612165/187862354-6399b1f3-fc07-4d97-8043-8a896fd5d063.png">  | <img width="863" alt="image" src="https://user-images.githubusercontent.com/12612165/187862411-97df95a5-ae00-4122-addf-31b1cb57bd6e.png">  | <img width="952" alt="image" src="https://user-images.githubusercontent.com/12612165/187862560-14f23b79-eff0-413a-a010-22f67387b7fd.png"> |

### Usage

If you want to load an asset into your `three.js` app, you have to put all external resources like `.blp` or `.skin` files into the same directory like the M2 file. Depending on the M2 version, you have to name resources files with their `FileDataID` or with their actual file name. 

This loader requires `three.js` in version `r144` or higher.
