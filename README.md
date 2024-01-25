# three-m2loader &middot; [![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Mugen87/yuka/blob/master/LICENSE) [![NPM Package](https://img.shields.io/npm/v/three-m2loader.svg)](https://www.npmjs.com/package/three-m2loader)

### M2 Loader for three.js

`three-m2loader` allows you to import M2 assets from World of Warcraft into your `three.js` app.

| druidcat2.m2  | 7ne_druid_worktable02.m2 | gilneas_fountain01.m2 |
| ------------- | ------------- | ------------- |
| <img width="831" alt="image" src="https://user-images.githubusercontent.com/12612165/187862354-6399b1f3-fc07-4d97-8043-8a896fd5d063.png">  | <img width="863" alt="image" src="https://user-images.githubusercontent.com/12612165/187862411-97df95a5-ae00-4122-addf-31b1cb57bd6e.png">  | <img width="952" alt="image" src="https://user-images.githubusercontent.com/12612165/187862560-14f23b79-eff0-413a-a010-22f67387b7fd.png"> |

### Basic Usage

If you want to load an asset into your `three.js` app, you have to put all external resources like `.blp` or `.skin` files into the same directory like the M2 file. Depending on the M2 version, you have to name resources files with their `FileDataID` or with their actual file name. 

A minimal code example looks like so:

```js
import { M2Loader } from 'three-m2loader';

const loader = new M2Loader();
loader.load( 'models/cat/druidcat2.m2', function ( group ) {

    scene.add( group );

} );
```

### Animations

#### Sequences

Animations in M2 are called *sequences*. The playback of sequences is managed with an instance of `SequenceManager`. You can access it in the `userData` field of the returned group. 
```js
const manager = group.userData.sequenceManager;
```

You can list all available sequences of a M2 asset with `listSequences()`. The list represents an array with objects that hold the `id` and `name` of a sequence.
```js
const sequences = manager.listSequences();
```
If you want to play a sequence, you can use `playSequence()`. `stopSequence()` stops the playback.
```js
manager.playSequence( sequence.id ); // start playback
manager.stopSequence( sequence.id ); // stop playback
```
If you want to stop the playback of all active sequences, you can use the convenience method `stopAllSequences()`.

#### Variations

Certain sequences like `Stand` or `AttackUnarmed` have multiple variations. You can list them for a given sequence via `listVariations()`.

```js
const variations = manager.listVariations( sequence.id );
```
Keep in mind that all sequences have at least one variation (default). If you want to play or stop a sequence with a specific variation, use the second parameter of `playSequence()` and `stopSequence()`.
```js
manager.playSequence( sequence.id, variationIndex ); // start playback
manager.stopSequence( sequence.id, variationIndex ); // stop playback
```

#### Global Sequences

Certain M2 assets have so-called *global sequences*. They represent animations that are active all the time like the flowing water of a fountain or the effects of elemental spirits.
You can check if a M2 asset has global sequences with `hasGlobalSequences()` and control the playback via `playGlobalSequences()` and `stopGlobalSequences()`.

```js
if ( manager.hasGlobalSequences() ) {

    manager.playGlobalSequences();

}
```

### Skins

Some models (especially creatures) require the definition of a skin. This can be done with an instance of `M2Options` and the `setSkin()` method. You have to pass in the `FileDataID`s
of the textures that should represent the skin.

```js
const options = new M2Options();
options.setSkin( 2015464, 123060 ); // 2015464 and 123060 are FileDataIDs representing BLP textures

const loader = new M2Loader();
loader.load( 'bearmount/bearmount.m2', function ( group ) {

    scene.add( group );

}, undefined, undefined, options );
```
You can use the same approach to overwrite the default skin of creatures (e.g. to switch the body color).

To retain the parameter order of `three.js` loaders, the `options` parameter comes after the three callback functions `onLoad()`, `onProgress()` and `onError()`.
 
### Misc

This loader requires `three.js` in version `r144` or higher.
