import {
	AdditiveBlending,
	AnimationClip,
	Bone,
	BufferGeometry,
	CompressedTexture,
	DoubleSide,
	FileLoader,
	Float32BufferAttribute,
	FrontSide,
	Group,
	Loader,
	LoaderUtils,
	Mesh,
	MeshBasicMaterial,
	MeshLambertMaterial,
	NumberKeyframeTrack,
	Quaternion,
	RepeatWrapping,
	RGBA_S3TC_DXT1_Format,
	RGBA_S3TC_DXT3_Format,
	RGBA_S3TC_DXT5_Format,
	RGBA_BPTC_Format,
	Skeleton,
	Vector2,
	Vector3,
	VectorKeyframeTrack
} from 'three';

/**
* The loader in its current state is just a foundation for a more advanced M2 loader. Right now, the class only implements
* a small portion of what is defined at https://wowdev.wiki/M2.
*/
class M2Loader extends Loader {

	/**
	* Constructs a new loader instance.
	*
	* @param {THREE.LoadingManager} manager - The loading manager.
	*/
	constructor( manager ) {

		super( manager );

	}

	/**
	* Method for loading an M2 asset by the given URL.
	*
	* @param {String} url - The URL to the M2 asset.
	* @param {onLoad} onLoad - A callback function executed when the asset has been loaded.
	* @param {onProgress} onProgress - A callback function executed during the loading process indicating the progress.
	* @param {onError} onError - A callback function executed when an error occurs.
	*/
	load( url, onLoad, onProgress, onError ) {

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( url, ( buffer ) => {

			try {

				this.parse( buffer, url, function ( object ) {

					onLoad( object );

				} );

			} catch ( e ) {

				if ( onError ) {

					onError( e );

				} else {

					console.error( e );

				}

				this.manager.itemError( url );

			}

		}, onProgress, onError );

	}

	/**
	* This method parses the loaded M2 data and creates three.js entities for rendering.
	*
	* @param {ArrayBuffer} buffer - The loaded M2 data.
	* @param {String} url - The URL to the M2 asset.
	* @param {onLoad} onLoad - A callback function executed when the asset has been loaded.
	* @param {onError} onError - A callback function executed when an error occurs.
	*/
	parse( buffer, url, onLoad, onError ) {

		const parser = new BinaryParser( buffer );

		let chunks = new Map();
		let chunkedFile = false;

		// magic

		let magic = parser.readString( 4 );

		if ( magic === 'MD21' ) {

			chunkedFile = true;

			parser.offset += 4; // skip "size" field of MD21 chunk

			parser.chunkOffset = parser.offset; // offsets inside chunks are relative to the chunk, not the file

			magic = parser.readString( 4 );

		}

		if ( magic !== 'MD20' ) {

			throw new Error( 'THREE.M2Loader: Invalid magic data' );

		}

		// headers

		const header = this._readHeader( parser );

		// chunks

		if ( chunkedFile === true ) {

			chunks = this._readChunks( buffer, header );

		}

		// data

		const name = this._readName( parser, header );
		const vertices = this._readVertices( parser, header );
		const colors = this._readColors( parser, header ); // eslint-disable-line no-unused-vars
		const materialDefinitions = this._readMaterialDefinitions( parser, header );
		const textureDefinitions = this._readTextureDefinitions( parser, header );
		const textureTransformDefinitions = this._readTextureTransformDefinitions( parser, header );
		const textureWeightDefinitions = this._readTextureWeightDefinitions( parser, header );
		const boneDefinitions = this._readBoneDefinitions( parser, header );

		// lookup tables

		const lookupTables = {};
		lookupTables.bones = this._readBoneLookupTable( parser, header );
		lookupTables.textures = this._readTextureLookupTable( parser, header );
		lookupTables.textureTransforms = this._readTextureTransformsLookupTable( parser, header );
		lookupTables.textureWeights = this._readTextureWeightsLookupTable( parser, header );

		// loaders

		const resourcePath = LoaderUtils.extractUrlBase( url );

		const textureLoader = new BLPLoader( this.manager );
		textureLoader.setPath( resourcePath );
		textureLoader.setHeader( header );

		const skinLoader = new M2SkinLoader( this.manager );
		skinLoader.setPath( resourcePath );
		skinLoader.setHeader( header );

		// textures

		const texturePromises = this._buildTextures( textureDefinitions, textureLoader, name, chunks );

		// skins

		Promise.all( texturePromises ).then( ( textures ) => {

			// skins

			if ( header.version <= M2_VERSION_THE_BURNING_CRUSADE ) {

				// TODO: read embedded skin data

			} else {

				let filename = ( name + '00.skin' ).toLowerCase(); // default skin name based on .m2 file

				const skinFileDataIDs = chunks.get( 'SFID' );

				if ( skinFileDataIDs !== undefined ) {

					filename = skinFileDataIDs[ 0 ] + '.skin';

				}

				const promise = new Promise( ( resolve, reject ) => {

					skinLoader.load( filename, resolve, undefined, () => {

						reject( new Error( 'THREE.M2Loader: Failed to load skin file: ' + filename ) );

					} );

				} );

				// build

				promise.then( skinData => {

					const geometries = this._buildGeometries( skinData, vertices );
					const skeleton = this._buildSkeleton( boneDefinitions ); // eslint-disable-line no-unused-vars
					const materials = this._buildMaterials( materialDefinitions );
					const textureTransforms = this._buildTextureTransforms( textureTransformDefinitions );
					const textureWeights = this._buildTextureWeights( textureWeightDefinitions );
					const group = this._buildObjects( name, geometries, materials, textures, textureTransforms, textureWeights, skinData, lookupTables );

					onLoad( group );

				} ).catch( onError );

			}

		} ).catch( onError );

	}

	_buildObjects( name, geometries, materials, textures, textureTransforms, textureWeights, skinData, lookupTables ) {

		const group = new Group();
		group.name = name;

		// meshes

		const batches = skinData.batches;

		for ( let i = 0; i < batches.length; i ++ ) {

			const batch = batches[ i ];

			const animations = [];
			const geometry = geometries[ batch.skinSectionIndex ];
			const material = materials[ batch.materialIndex ];

			// texture

			const textureIndex = lookupTables.textures[ batch.textureComboIndex ];

			if ( textureIndex !== undefined ) {

				material.map = textures[ textureIndex ];

			}

			// texture transform animations

			const textureTransformIndex = lookupTables.textureTransforms[ batch.textureTransformComboIndex ];

			if ( textureTransformIndex !== undefined ) {

				const textureTransform = textureTransforms[ textureTransformIndex ];

				if ( textureTransform !== undefined ) {

					animations.push( ...textureTransform );

				}

			}

			// opacity animations

			const textureWeightIndex = lookupTables.textureWeights[ batch.textureWeightComboIndex ];

			if ( textureWeightIndex !== undefined ) {

				const textureWeight = textureWeights[ textureWeightIndex ];

				if ( textureWeight !== undefined ) {

					animations.push( ...textureWeight );

				}

			}

			// mesh

			const mesh = new Mesh( geometry, material );
			mesh.animations.push( ...animations );

			group.add( mesh );

		}

		return group;

	}

	_buildGeometries( skinData, vertices ) {

		// geometry

		const localVertexList = skinData.localVertexList;
		const indices = skinData.indices;
		const submeshes = skinData.submeshes;

		// buffer attributes

		const position = [];
		const normal = [];
		const uv = [];

		for ( let i = 0; i < localVertexList.length; i ++ ) {

			const vertexIndex = localVertexList[ i ];
			const vertex = vertices[ vertexIndex ];

			// TODO: Implement up-axis conversion (z-up to y-up), figure out if WoW is left- or right-handed

			position.push( vertex.pos.x, vertex.pos.y, vertex.pos.z );
			normal.push( vertex.normal.x, vertex.normal.y, vertex.normal.z );
			uv.push( vertex.texCoords[ 0 ].x, vertex.texCoords[ 0 ].y );

		}

		const positionAttribute = new Float32BufferAttribute( position, 3 );
		const normalAttribute = new Float32BufferAttribute( normal, 3 );
		const uvAttribute = new Float32BufferAttribute( uv, 2 );

		// geometries

		const geometries = [];

		for ( let i = 0; i < submeshes.length; i ++ ) {

			const submesh = submeshes[ i ];

			const index = indices.slice( submesh.indexStart, submesh.indexStart + submesh.indexCount );

			const geometry = new BufferGeometry();
			geometry.setAttribute( 'position', positionAttribute );
			geometry.setAttribute( 'normal', normalAttribute );
			geometry.setAttribute( 'uv', uvAttribute );
			geometry.setIndex( index );

			geometries.push( geometry );

		}

		return geometries;

	}

	_buildMaterials( materialDefinitions ) {

		const materials = [];

		for ( let i = 0; i < materialDefinitions.length; i ++ ) {

			const materialDefinition = materialDefinitions[ i ];

			const materialFlags = materialDefinition.flags;
			const blendingMode = materialDefinition.blendingMode;

			// TODO Honor remaining material flags and blending modes

			const material = ( materialFlags & M2_MATERIAL_UNLIT ) ? new MeshBasicMaterial() : new MeshLambertMaterial();

			material.fog = ( materialFlags & M2_MATERIAL_UNFOGGED ) ? false : true;
			material.side = ( materialFlags & M2_MATERIAL_TWO_SIDED ) ? DoubleSide : FrontSide;
			material.depthTest = ( materialFlags & M2_MATERIAL_DEPTH_TEST ) ? false : true;
			material.depthWrite = ( materialFlags & M2_MATERIAL_DEPTH_WRITE ) ? false : true;

			switch ( blendingMode ) {

				case M2_BLEND_OPAQUE:
					material.alphaTest = 0;
					material.transparent = false;
					break;

				case M2_BLEND_ALPHA_KEY:
					material.alphaTest = 0.5;
					material.transparent = false;
					break;

				case M2_BLEND_ALPHA:
					material.alphaTest = 0;
					material.transparent = true;
					break;

				case M2BLEND_ADD:
					material.alphaTest = 0;
					material.transparent = true;
					material.blending = AdditiveBlending;
					break;

				default:
					console.warn( 'THREE.M2Loader: Unsupported blending mode.' );
					break;


			}

			materials.push( material );

		}

		return materials;

	}

	_buildSkeleton( boneDefinitions ) {

		// TODO: Find out a better way for detecting static models
		// Problem: Even static models have some bone definitions

		if ( boneDefinitions.length < 8 ) return null;

		const bones = [];

		for ( let i = 0; i < boneDefinitions.length; i ++ ) {

			const boneDefinition = boneDefinitions[ i ];
			const bone = new Bone();

			bones.push( bone );

			const parentIndex = boneDefinition.parentBone;

			if ( parentIndex !== - 1 ) bones[ parentIndex ].add( bone );

		}

		return new Skeleton( bones );

	}

	_buildTextures( textureDefinitions, loader, name, chunks ) {

		const promises = [];

		for ( let i = 0; i < textureDefinitions.length; i ++ ) {

			const textureDefinition = textureDefinitions[ i ];
			let filename = textureDefinition.filename;

			// if the filename is empty, use the FileDataID field from the TXID chunk

			if ( filename === '' ) {

				const textureFileDataIds = chunks.get( 'TXID' );

				if ( textureFileDataIds !== undefined ) {

					filename = textureFileDataIds[ i ] + '.blp';

				}

			}

			// fallback: if the first texture has an empty name, use .m2 name

			if ( filename === '' ) {

				if ( i === 0 ) {

					filename = ( name + '.blp' ).toLowerCase();

				} else {

					continue;

				}

			}

			//

			const promise = new Promise( ( resolve, reject ) => {

				const config = {
					url: filename,
					flags: textureDefinition.flags
				};

				loader.load( config, resolve, undefined, () => {

					reject( new Error( 'THREE.M2Loader: Failed to load texture: ' + config.url ) );

				} );

			} );

			promises.push( promise );

		}

		return promises;

	}

	_buildTextureTransforms( textureTransformDefinitions ) {

		const textureTransforms = [];

		for ( let i = 0; i < textureTransformDefinitions.length; i ++ ) {

			const textureTransformDefinition = textureTransformDefinitions[ i ];

			if ( textureTransformDefinition !== undefined ) {

				const animations = [];
				const keyframes = [];

				// translation

				for ( let j = 0; j < textureTransformDefinition.translation.timestamps.length; j ++ ) {

					const ti = textureTransformDefinition.translation.timestamps[ j ];
					const vi = textureTransformDefinition.translation.values[ j ];

					const times = [];
					const values = [];

					// ignore empty tracks

					if ( ti.length <= 1 ) continue;

					// times

					for ( let k = 0; k < ti.length; k ++ ) {

						times.push( ti[ k ] / 1000 );

					}

					// values

					for ( let k = 0; k < vi.length; k += 3 ) {

						// extract x,y, ignore z

						values.push( vi[ k ] );
						values.push( vi[ k + 1 ] );

					}

					if ( keyframes[ j ] === undefined ) keyframes[ j ] = [];

					keyframes[ j ].push( new VectorKeyframeTrack( '.material.map.offset', times, values ) );

				}

				// rotation

				const q = new Quaternion();
				const v0 = new Vector3();
				const v1 = new Vector3( 0, 1, 0 );
				const up = new Vector3( 0, 0, - 1 );
				const cross = new Vector3();

				for ( let j = 0; j < textureTransformDefinition.rotation.timestamps.length; j ++ ) {

					const ti = textureTransformDefinition.rotation.timestamps[ j ];
					const vi = textureTransformDefinition.rotation.values[ j ];

					const times = [];
					const values = [];

					// ignore empty tracks

					if ( ti.length <= 1 ) continue;

					// times

					for ( let k = 0; k < ti.length; k ++ ) {

						times.push( ti[ k ] / 1000 );

					}

					// values

					let r = 0;

					for ( let k = 0; k < vi.length; k += 4 ) {

						// convert quaterion to single angle
						// it's not possible to use angleTo() since this method returns angles in the range [0,π] (instead of [-π, π]).
						// TODO: Verify if this approach works with other assets than g_scourgerunecirclecrystal.m2

						q.fromArray( vi, k );

						v0.copy( v1 );
						v1.set( 0, 1, 0 ).applyQuaternion( q );

						const dot = v0.dot( v1 );
						const det = up.dot( cross.crossVectors( v0, v1 ) );
						r += Math.atan2( det, dot );

						values.push( r );

					}

					if ( keyframes[ j ] === undefined ) keyframes[ j ] = [];

					keyframes[ j ].push( new NumberKeyframeTrack( '.material.map.rotation', times, values ) );

				}

				for ( let j = 0; j < keyframes.length; j ++ ) {

					const clip = new AnimationClip( 'TextureTransform_' + j, - 1, [ ... keyframes[ j ] ] );
					animations.push( clip );

				}

				textureTransforms.push( animations );

			}

		}

		return textureTransforms;

	}

	_buildTextureWeights( textureWeightDefinitions ) {

		const textureWeights = [];

		for ( let i = 0; i < textureWeightDefinitions.length; i ++ ) {

			const textureWeightDefinition = textureWeightDefinitions[ i ];

			if ( textureWeightDefinition !== undefined ) {

				const animations = [];
				const opacityKeyFrames = [];

				for ( let j = 0; j < textureWeightDefinition.timestamps.length; j ++ ) {

					const ti = textureWeightDefinition.timestamps[ j ];
					const vi = textureWeightDefinition.values[ j ];

					const times = [];
					const values = [];

					// ignore empty tracks

					if ( ti.length <= 1 ) continue;


					// times

					for ( let k = 0; k < ti.length; k ++ ) {

						times.push( ti[ k ] / 1000 );

					}

					// values

					for ( let k = 0; k < vi.length; k ++ ) {

						values.push( vi[ k ] );

					}

					opacityKeyFrames.push( new NumberKeyframeTrack( '.material.opacity', times, values ) );

				}

				for ( let j = 0; j < opacityKeyFrames.length; j ++ ) {

					const clip = new AnimationClip( 'Opacity_' + j, - 1, [ opacityKeyFrames[ j ] ] );
					animations.push( clip );

				}

				textureWeights.push( animations );

			}

		}

		return textureWeights;

	}

	_readHeader( parser ) {

		const header = {};

		header.version = parser.readUInt32();
		header.nameLength = parser.readUInt32();
		header.nameOffset = parser.readUInt32();
		header.globalFlags = parser.readUInt32();
		header.globalLoopsLength = parser.readUInt32();
		header.globalLoopsOffset = parser.readUInt32();
		header.sequencesLength = parser.readUInt32();
		header.sequencesOffset = parser.readUInt32();
		header.sequenceIdxHashByIdLength = parser.readUInt32();
		header.sequenceIdxHashByOffset = parser.readUInt32();

		if ( header.version <= M2_VERSION_THE_BURNING_CRUSADE ) {

			header.playableAnimationLookupLength = parser.readUInt32();
			header.playableAnimationLookupOffset = parser.readUInt32();

		}

		header.bonesLength = parser.readUInt32();
		header.bonesOffset = parser.readUInt32();
		header.boneIndicesByIdLength = parser.readUInt32();
		header.boneIndicesByIdOffset = parser.readUInt32();
		header.verticesLength = parser.readUInt32();
		header.verticesOffset = parser.readUInt32();

		if ( header.version <= M2_VERSION_THE_BURNING_CRUSADE ) {

			header.skinProfilesLength = parser.readUInt32();
			header.skinProfilesOffset = parser.readUInt32();

		} else {

			header.numSkinProfiles = parser.readUInt32();

		}

		header.colorsLength = parser.readUInt32();
		header.colorsOffset = parser.readUInt32();
		header.texturesLength = parser.readUInt32();
		header.texturesOffset = parser.readUInt32();
		header.textureWeightsLength = parser.readUInt32();
		header.textureWeightsOffset = parser.readUInt32();

		if ( header.version <= M2_VERSION_THE_BURNING_CRUSADE ) {

			header.textureFlipbooksLength = parser.readUInt32();
			header.textureFlipbooksOffset = parser.readUInt32();

		}

		header.textureTransformsLength = parser.readUInt32();
		header.textureTransformsOffset = parser.readUInt32();
		header.textureIndicesByIdLength = parser.readUInt32();
		header.textureIndicesByIdOffset = parser.readUInt32();
		header.materialsLength = parser.readUInt32();
		header.materialsOffset = parser.readUInt32();
		header.boneLookupTableLength = parser.readUInt32();
		header.boneLookupTableOffset = parser.readUInt32();
		header.textureLookupTableLength = parser.readUInt32();
		header.textureLookupTableOffset = parser.readUInt32();
		header.textureUnitLookupTableLength = parser.readUInt32();
		header.textureUnitLookupTableOffset = parser.readUInt32();
		header.transparencyLookupTableLength = parser.readUInt32();
		header.transparencyLookupTableOffset = parser.readUInt32();
		header.textureTransformsLookupTableLength = parser.readUInt32();
		header.textureTransformsLookupTableOffset = parser.readUInt32();

		return header;

	}

	//

	_readBoneLookupTable( parser, header ) {

		const length = header.boneLookupTableLength;
		const offset = header.boneLookupTableOffset;

		parser.saveState();
		parser.moveTo( offset );

		const lookupTable = [];

		for ( let i = 0; i < length; i ++ ) {

			lookupTable.push( parser.readUInt16() );

		}

		parser.restoreState();

		return lookupTable;

	}

	_readBoneDefinition( parser, header ) {

		const bone = new M2Bone();

		bone.keyBoneId = parser.readInt32();
		bone.flags = parser.readUInt32();
		bone.parentBone = parser.readInt16();
		bone.submeshId = parser.readUInt16();
		bone.boneNameCRC = parser.readUInt32();

		bone.translation = this._readTrack( parser, header, 'vec3' );
		bone.rotation = this._readTrack( parser, header, 'quatCompressed' );
		bone.scale = this._readTrack( parser, header, 'vec3' );

		bone.pivot.set(
			parser.readFloat32(),
			parser.readFloat32(),
			parser.readFloat32()
		);

		return bone;

	}

	_readBoneDefinitions( parser, header ) {

		const length = header.bonesLength;
		const offset = header.bonesOffset;

		parser.saveState();
		parser.moveTo( offset );

		const bones = [];

		for ( let i = 0; i < length; i ++ ) {

			const bone = this._readBoneDefinition( parser, header );
			bones.push( bone );

		}

		parser.restoreState();

		return bones;

	}

	_readChunks( buffer, header ) {

		const parser = new BinaryParser( buffer );

		const chunkMap = new Map();
		const data = new Map();

		while ( parser.offset < buffer.byteLength ) {

			const id = parser.readString( 4 );
			const size = parser.readUInt32();

			const start = parser.offset;
			const end = parser.offset + size;

			chunkMap.set( id, { start, end } );

			parser.offset = end;

		}

		// TXID

		const txid = chunkMap.get( 'TXID' );

		if ( txid !== undefined ) {

			parser.moveTo( txid.start );

			const textureFileDataIds = [];

			while ( parser.offset < txid.end ) {

				textureFileDataIds.push( parser.readUInt32() );

			}

			data.set( 'TXID', textureFileDataIds );

		}

		// SFID

		const sfid = chunkMap.get( 'SFID' );

		if ( sfid !== undefined ) {

			parser.moveTo( sfid.start );

			const skinFileDataIDs = [];

			for ( let i = 0; i < header.numSkinProfiles; i ++ ) {

				skinFileDataIDs.push( parser.readUInt32() );

			}

			data.set( 'SFID', skinFileDataIDs );

		}

		return data;

	}

	_readColors( parser, header ) {

		const length = header.colorsLength;
		const offset = header.colorsOffset;

		parser.saveState();
		parser.moveTo( offset );

		const colors = [];

		for ( let i = 0; i < length; i ++ ) {

			const color = new M2Color();

			color.color = this._readTrack( parser, header, 'vec3' );
			color.alpha = this._readTrack( parser, header, 'fixed16' );

			colors.push( color );

		}

		parser.restoreState();

		return colors;

	}

	_readMaterialDefinitions( parser, header ) {

		const length = header.materialsLength;
		const offset = header.materialsOffset;

		parser.saveState();
		parser.moveTo( offset );

		const materials = [];

		for ( let i = 0; i < length; i ++ ) {

			const material = new M2Material();

			material.flags = parser.readUInt16();
			material.blendingMode = parser.readUInt16();

			materials.push( material );

		}

		parser.restoreState();

		return materials;

	}

	_readName( parser, header ) {

		const length = header.nameLength;
		const offset = header.nameOffset;

		parser.saveState();
		parser.moveTo( offset );

		const name = parser.readString( length ).replace( /\0/g, '' ); // remove control characters

		parser.restoreState();

		return name;

	}

	_readTextureDefinitions( parser, header ) {

		const length = header.texturesLength;
		const offset = header.texturesOffset;

		parser.saveState();
		parser.moveTo( offset );

		const textures = [];

		for ( let i = 0; i < length; i ++ ) {

			const texture = this._readTextureDefinition( parser );
			textures.push( texture );

		}

		parser.restoreState();

		return textures;

	}

	_readTextureDefinition( parser ) {

		const texture = new M2Texture();

		texture.type = parser.readUInt32();
		texture.flags = parser.readUInt32();

		const length = parser.readUInt32();
		const offset = parser.readUInt32();

		parser.saveState();
		parser.moveTo( offset );

		let filename = parser.readString( length );
		filename = filename.replace( /\0/g, '' ); // remove control characters
		filename = filename.replace( /^.*[\\\/]/, '' ); // remove directory path
		filename = filename.toLowerCase(); // ensure lowercase characters

		texture.filename = filename;

		parser.restoreState();

		return texture;

	}

	_readTextureLookupTable( parser, header ) {

		const length = header.textureLookupTableLength;
		const offset = header.textureLookupTableOffset;

		parser.saveState();
		parser.moveTo( offset );

		const lookupTable = [];

		for ( let i = 0; i < length; i ++ ) {

			lookupTable.push( parser.readUInt16() );

		}

		parser.restoreState();

		return lookupTable;

	}

	_readTextureTransformDefinitions( parser, header ) {

		const length = header.textureTransformsLength;
		const offset = header.textureTransformsOffset;

		parser.saveState();
		parser.moveTo( offset );

		const textureTransforms = [];

		for ( let i = 0; i < length; i ++ ) {

			const textureTransform = this._readTextureTransformDefinition( parser, header );
			textureTransforms.push( textureTransform );

		}

		parser.restoreState();

		return textureTransforms;


	}

	_readTextureTransformDefinition( parser, header ) {

		const textureTransform = new M2TextureTransform();

		textureTransform.translation = this._readTrack( parser, header, 'vec3' );
		textureTransform.rotation = this._readTrack( parser, header, 'quat' );
		textureTransform.scale = this._readTrack( parser, header, 'vec3' );

		return textureTransform;

	}

	_readTextureTransformsLookupTable( parser, header ) {

		const length = header.textureTransformsLookupTableLength;
		const offset = header.textureTransformsLookupTableOffset;

		parser.saveState();
		parser.moveTo( offset );

		const lookupTable = [];

		for ( let i = 0; i < length; i ++ ) {

			lookupTable.push( parser.readUInt16() );

		}

		parser.restoreState();

		return lookupTable;

	}

	_readTextureWeightDefinitions( parser, header ) {

		const length = header.textureWeightsLength;
		const offset = header.textureWeightsOffset;

		parser.saveState();
		parser.moveTo( offset );

		const textureWeights = [];

		for ( let i = 0; i < length; i ++ ) {

			const track = this._readTrack( parser, header, 'fixed16' );

			textureWeights.push( track );

		}

		parser.restoreState();

		return textureWeights;

	}

	_readTextureWeightsLookupTable( parser, header ) {

		const length = header.transparencyLookupTableLength;
		const offset = header.transparencyLookupTableOffset;

		parser.saveState();
		parser.moveTo( offset );

		const lookupTable = [];

		for ( let i = 0; i < length; i ++ ) {

			lookupTable.push( parser.readUInt16() );

		}

		parser.restoreState();

		return lookupTable;

	}

	_readTrack( parser, header, type ) {

		const track = new M2Track();

		track.interpolationType = parser.readUInt16();
		track.globalSequence = parser.readInt16();

		// timestamps

		if ( header.version < M2_VERSION_WRATH_OF_THE_LICH_KING ) {

			// TODO: Implement track parsing for older M2 assets

		} else {

			const timestampsLength = parser.readUInt32();
			const timestampsOffset = parser.readUInt32();

			parser.saveState();
			parser.moveTo( timestampsOffset );

			for ( let i = 0; i < timestampsLength; i ++ ) {

				const values = [];

				const entryLength = parser.readUInt32();
				const entryOffset = parser.readUInt32();

				parser.saveState();
				parser.moveTo( entryOffset );

				for ( let j = 0; j < entryLength; j ++ ) {

					values.push( parser.readUInt32() );

				}

				track.timestamps.push( values );

				parser.restoreState();

			}

			parser.restoreState();

			// values

			const valuesLength = parser.readUInt32();
			const valuesOffset = parser.readUInt32();

			parser.saveState();
			parser.moveTo( valuesOffset );

			for ( let i = 0; i < valuesLength; i ++ ) {

				const values = [];

				const entryLength = parser.readUInt32();
				const entryOffset = parser.readUInt32();

				parser.saveState();
				parser.moveTo( entryOffset );

				for ( let j = 0; j < entryLength; j ++ ) {

					switch ( type ) {

						case 'fixed16':

							values.push(
								parser.readInt16() / 0x7fff
							);

							break;

						case 'vec2':

							values.push(
								parser.readFloat32(),
								parser.readFloat32()
							);

							break;

						case 'vec3':

							values.push(
								parser.readFloat32(),
								parser.readFloat32(),
								parser.readFloat32()
							);

							break;

						case 'quatCompressed':

							values.push(
								parser.readFloat32(),
								parser.readFloat32(),
								parser.readFloat32(),
								parser.readFloat32()
							);

							break;

						case 'quat':

							values.push(
								parser.readFloat32(),
								parser.readFloat32(),
								parser.readFloat32(),
								parser.readFloat32()
							);

							break;

						default:
							break;

					}

				}

				track.values.push( values );

				parser.restoreState();

			}

			parser.restoreState();

		}

		//

		return track;

	}

	_readVertices( parser, header ) {

		const length = header.verticesLength;
		const offset = header.verticesOffset;

		parser.saveState();
		parser.moveTo( offset );

		const vertices = [];

		for ( let i = 0; i < length; i ++ ) {

			const vertex = this._readVertex( parser );
			vertices.push( vertex );

		}

		parser.restoreState();

		return vertices;

	}

	_readVertex( parser ) {

		const vertex = new M2Vertex();

		vertex.pos.x = parser.readFloat32();
		vertex.pos.y = parser.readFloat32();
		vertex.pos.z = parser.readFloat32();

		vertex.boneWeights.push(
			parser.readUInt8(),
			parser.readUInt8(),
			parser.readUInt8(),
			parser.readUInt8()
		);

		vertex.boneIndices.push(
			parser.readUInt8(),
			parser.readUInt8(),
			parser.readUInt8(),
			parser.readUInt8()
		);

		vertex.normal.x = parser.readFloat32();
		vertex.normal.y = parser.readFloat32();
		vertex.normal.z = parser.readFloat32();

		vertex.texCoords[ 0 ].x = parser.readFloat32();
		vertex.texCoords[ 0 ].y = parser.readFloat32();

		vertex.texCoords[ 1 ].x = parser.readFloat32();
		vertex.texCoords[ 1 ].y = parser.readFloat32();

		return vertex;

	}

}

// const M2_GLOBAL_FLAGS_TILT_X = 0x1;
// const M2_GLOBAL_FLAGS_TILT_Y = 0x2;
// const M2_GLOBAL_FLAGS_USE_TEXTURE_COMBINER_INFOS = 0x8;
// const M2_GLOBAL_FLAGS_LOAD_PHYS_DATA = 0x20;
// const M2_GLOBAL_FLAGS_UNK_1 = 0x80;
// const M2_GLOBAL_FLAGS_CAMERA_RELATED = 0x100;
// const M2_GLOBAL_FLAGS_NEW_PARTICLE_RECORD = 0x200;
// const M2_GLOBAL_FLAGS_UNK_2 = 0x400;
// const M2_GLOBAL_FLAGS_TEXTURE_TRANSFORMS_USE_BONE_SEQUENCES = 0x800;
// const M2_GLOBAL_FLAGS_UNK_3 = 0x1000;
// const M2_GLOBAL_FLAGS_CHUNKED_ANIM_FILES = 0x2000;

// const M2_VERSION_CLASSIC = 256;
const M2_VERSION_THE_BURNING_CRUSADE = 263;
const M2_VERSION_WRATH_OF_THE_LICH_KING = 264;
// const M2_VERSION_CATACLYSM = 272;
// const M2_VERSION_MISTS_OF_PANDARIA = 272;
// const M2_VERSION_WARLORDS_OF_DRAENOR = 272;
// const M2_VERSION_LEGION = 274;
// const M2_VERSION_BATTLE_FOR_AZEROTH = 274;
// const M2_VERSION_SHADOWLANDS = 274;

const M2_MATERIAL_UNLIT = 0x01;
const M2_MATERIAL_UNFOGGED = 0x02;
const M2_MATERIAL_TWO_SIDED = 0x04;
const M2_MATERIAL_DEPTH_TEST = 0x08;
const M2_MATERIAL_DEPTH_WRITE = 0x10;

const M2_BLEND_OPAQUE = 0;
const M2_BLEND_ALPHA_KEY = 1;
const M2_BLEND_ALPHA = 2;
const M2BLEND_ADD = 4;

//

class M2SkinLoader extends Loader {

	constructor( manager ) {

		super( manager );

		this.header = null;

	}

	setHeader( header ) {

		this.header = header;

	}

	load( url, onLoad, onProgress, onError ) {

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( url, ( buffer ) => {

			try {

				onLoad( this.parse( buffer ) );

			} catch ( e ) {

				if ( onError ) {

					onError( e );

				} else {

					console.error( e );

				}

				this.manager.itemError( url );

			}

		}, onProgress, onError );

	}

	parse( buffer ) {

		const parser = new BinaryParser( buffer );
		const header = this.header;

		if ( header.version >= M2_VERSION_WRATH_OF_THE_LICH_KING ) {

			const magic = parser.readString( 4 );

			if ( magic !== 'SKIN' ) {

				throw new Error( 'THREE.M2SkinLoader: Invalid magic data' );

			}

		}

		// header

		const verticesLength = parser.readUInt32();
		const verticesOffset = parser.readUInt32();
		const indicesLength = parser.readUInt32();
		const indicesOffset = parser.readUInt32();
		const bonesLength = parser.readUInt32();
		const bonesOffset = parser.readUInt32();
		const submeshesLength = parser.readUInt32();
		const submeshesOffset = parser.readUInt32();
		const batchesLength = parser.readUInt32();
		const batchesOffset = parser.readUInt32();

		// local vertex list

		const localVertexList = [];

		parser.moveTo( verticesOffset + 0x00 );

		for ( let i = 0; i < verticesLength; i ++ ) {

			localVertexList.push( parser.readUInt16() );

		}

		// indices

		const indices = [];

		parser.moveTo( indicesOffset + 0x00 );

		for ( let i = 0; i < indicesLength; i ++ ) {

			indices.push( parser.readUInt16() );

		}

		// bones

		const bones = [];

		parser.moveTo( bonesOffset + 0x00 );

		for ( let i = 0; i < bonesLength; i ++ ) {

			// each entry represents 4 bone indices

			bones.push( parser.readUInt8(), parser.readUInt8(), parser.readUInt8(), parser.readUInt8() );

		}

		// submeshes

		const submeshes = [];

		parser.moveTo( submeshesOffset + 0x00 );

		for ( let i = 0; i < submeshesLength; i ++ ) {

			const submesh = this._readSubmesh( parser, header );
			submeshes.push( submesh );

		}

		// batches

		const batches = [];

		parser.moveTo( batchesOffset + 0x00 );

		for ( let i = 0; i < batchesLength; i ++ ) {

			const batch = this._readBatch( parser );
			batches.push( batch );

		}

		//

		const boneCountMax = parser.readUInt32();

		// TODO read shadow batches

		return { localVertexList, indices, bones, submeshes, batches, boneCountMax };

	}

	_readBatch( parser ) {

		const batch = new M2Batch();

		batch.flags = parser.readUInt8();
		batch.priorityPlane = parser.readInt8();
		batch.shaderId = parser.readUInt16();
		batch.skinSectionIndex = parser.readUInt16();
		batch.geosetIndex = parser.readUInt16();
		batch.colorIndex = parser.readUInt16();
		batch.materialIndex = parser.readUInt16();
		batch.materialLayer = parser.readUInt16();
		batch.textureCount = parser.readUInt16();
		batch.textureComboIndex = parser.readUInt16();
		batch.textureCoordComboIndex = parser.readUInt16();
		batch.textureWeightComboIndex = parser.readUInt16();
		batch.textureTransformComboIndex = parser.readUInt16();

		return batch;

	}

	_readSubmesh( parser, header ) {

		const submesh = new M2SkinSection();

		submesh.skinSectionId = parser.readUInt16();
		submesh.Level = parser.readUInt16();
		submesh.vertexStart = parser.readUInt16();
		submesh.vertexCount = parser.readUInt16();
		submesh.indexStart = parser.readUInt16();
		submesh.indexCount = parser.readUInt16();
		submesh.boneCount = parser.readUInt16();
		submesh.boneComboIndex = parser.readUInt16();
		submesh.boneInfluences = parser.readUInt16();
		submesh.centerBoneIndex = parser.readUInt16();

		submesh.centerPosition.set(
			parser.readFloat32(),
			parser.readFloat32(),
			parser.readFloat32()
		);

		if ( header.version >= M2_VERSION_THE_BURNING_CRUSADE ) {

			submesh.sortCenterPosition.set(
				parser.readFloat32(),
				parser.readFloat32(),
				parser.readFloat32()
			);

			submesh.sortRadius = parser.readFloat32();

		}

		return submesh;

	}

}

//

class BLPLoader extends Loader {

	constructor( manager ) {

		super( manager );

		this.header = null;

	}

	setHeader( header ) {

		this.header = header;

	}

	load( config, onLoad, onProgress, onError ) {

		const url = config.url;
		const flags = config.flags;

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( url, ( buffer ) => {

			try {

				onLoad( this.parse( buffer, url, flags ) );

			} catch ( e ) {

				if ( onError ) {

					onError( e );

				} else {

					console.error( e );

				}

				this.manager.itemError( url );

			}

		}, onProgress, onError );

	}

	parse( buffer, url, flags ) {

		const parser = new BinaryParser( buffer );

		const magic = parser.readString( 4 );

		if ( magic !== 'BLP2' ) {

			throw new Error( 'THREE.BLPLoader: Invalid magic data.' );

		}

		// header

		const header = {};

		header.version = parser.readUInt32();
		header.colorEncoding = parser.readUInt8();
		header.alphaSize = parser.readUInt8();
		header.preferredFormat = parser.readUInt8();
		header.hasMips = parser.readUInt8();
		header.width = parser.readUInt32();
		header.height = parser.readUInt32();

		header.mipOffsets = [];
		header.mipSizes = [];

		for ( let i = 0; i < 16; i ++ ) {

			header.mipOffsets.push( parser.readUInt32() );

		}

		header.mipSizes = [];

		for ( let i = 0; i < 16; i ++ ) {

			header.mipSizes.push( parser.readUInt32() );

		}

		// data

		const mipmaps = [];

		let currentWidth = header.width;
		let currentHeight = header.height;

		for ( let i = 0; i < header.mipOffsets.length; i ++ ) {

			const offset = header.mipOffsets[ i ];

			if ( offset === 0 || currentWidth === 0 || currentHeight === 0 ) break;

			const size = header.mipSizes[ i ];
			const data = new Uint8Array( buffer, offset, size );

			mipmaps.push( { data: data, width: currentWidth, height: currentHeight } );

			currentWidth = Math.floor( currentWidth / 2 );
			currentHeight = Math.floor( currentHeight / 2 );

		}

		// setup texture

		let texture;

		if ( header.preferredFormat === BLP_PIXEL_FORMAT_PIXEL_DXT1 ||
			header.preferredFormat === BLP_PIXEL_FORMAT_PIXEL_DXT3 ||
			header.preferredFormat === BLP_PIXEL_FORMAT_PIXEL_DXT5 ||
			header.preferredFormat === BLP_PIXEL_FORMAT_PIXEL_BC5 ) {

			texture = new CompressedTexture( mipmaps, header.width, header.height );
			texture.center.set( 0.5, 0.5 );
			texture.needsUpdate = true;

			switch ( header.preferredFormat ) {

				case BLP_PIXEL_FORMAT_PIXEL_DXT1:
					texture.format = RGBA_S3TC_DXT1_Format;
					break;

				case BLP_PIXEL_FORMAT_PIXEL_DXT3:
					texture.format = RGBA_S3TC_DXT3_Format;
					break;

				case BLP_PIXEL_FORMAT_PIXEL_DXT5:
					texture.format = RGBA_S3TC_DXT5_Format;
					break;

				case BLP_PIXEL_FORMAT_PIXEL_BC5:
					texture.format = RGBA_BPTC_Format;
					break;

				default:
					throw new Error( 'THREE.BLPLoader: Unsupported compressed texture format: ' + header.preferredFormat );

			}

		} else {

			// TODO Handle uncompressed textures

		}

		//

		if ( flags & 0x1 ) texture.wrapS = RepeatWrapping;
		if ( flags & 0x2 ) texture.wrapT = RepeatWrapping;

		texture.name = url;

		return texture;

	}

}

// const BLP_COLOR_ENCODING_COLOR_JPEG = 0;
// const BLP_COLOR_ENCODING_COLOR_PALETTE = 1;
// const BLP_COLOR_ENCODING_COLOR_DXT = 2;
// const BLP_COLOR_ENCODING_ARGB8888 = 3;

const BLP_PIXEL_FORMAT_PIXEL_DXT1 = 0;
const BLP_PIXEL_FORMAT_PIXEL_DXT3 = 1;
// const BLP_PIXEL_FORMAT_PIXEL_ARGB8888 = 2;
// const BLP_PIXEL_FORMAT_PIXEL_ARGB1555 = 3;
// const BLP_PIXEL_FORMAT_PIXEL_ARGB4444 = 4;
// const BLP_PIXEL_FORMAT_PIXEL_RGB565 = 5;
// const BLP_PIXEL_FORMAT_PIXEL_A8 = 6;
const BLP_PIXEL_FORMAT_PIXEL_DXT5 = 7;
// const BLP_PIXEL_FORMAT_PIXEL_UNSPECIFIED = 8;
// const BLP_PIXEL_FORMAT_PIXEL_ARGB2565 = 9;
const BLP_PIXEL_FORMAT_PIXEL_BC5 = 11;
// const BLP_PIXEL_FORMAT_NUM_PIXEL_FORMATS = 12;

//

class BinaryParser {

	constructor( buffer ) {

		this.view = new DataView( buffer );

		this.offset = 0;
		this.chunkOffset = 0;

		this._savedOffsets = [];

	}

	moveTo( offset ) {

		this.offset = offset + this.chunkOffset;

	}

	readFloat32() {

		const float = this.view.getFloat32( this.offset, true );
		this.offset += 4;
		return float;

	}

	readInt8() {

		return this.view.getInt8( this.offset ++ );

	}

	readInt16() {

		const int = this.view.getInt16( this.offset, true );
		this.offset += 2;
		return int;

	}

	readInt32() {

		const int = this.view.getInt32( this.offset, true );
		this.offset += 4;
		return int;

	}

	readString( bytes ) {

		let string = '';

		for ( let i = 0; i < bytes; i ++ ) {

			string += String.fromCharCode( this.readUInt8() );

		}

		return string;

	}

	readUInt8() {

		return this.view.getUint8( this.offset ++ );

	}

	readUInt16() {

		const int = this.view.getUint16( this.offset, true );
		this.offset += 2;
		return int;

	}

	readUInt32() {

		const int = this.view.getUint32( this.offset, true );
		this.offset += 4;
		return int;

	}

	saveState() {

		this._savedOffsets.push( this.offset );

	}

	restoreState() {

		this.offset = this._savedOffsets.pop();

	}

}

// chunks

class M2Batch {

	constructor() {

		this.flags = 0;
		this.priorityPlane = 0;
		this.shader_id = 0;
		this.skinSectionIndex = 0;
		this.geosetIndex = 0;
		this.colorIndex = 0;
		this.materialIndex = 0;
		this.materialLayer = 0;
		this.textureCount = 0;
		this.textureComboIndex = 0;
		this.textureCoordComboIndex = 0;
		this.textureWeightComboIndex = 0;
		this.textureTransformComboIndex = 0;

	}

}

class M2Bone {

	constructor() {

		this.keyBoneId = 0;
		this.flags = 0;
		this.parentBone = 0;
		this.submeshId = 0;
		this.boneNameCRC = 0;
		this.translation = null;
		this.rotation = null;
		this.scale = null;
		this.pivot = new Vector3();

	}

}

class M2Color {

	constructor() {

		this.color = null;
		this.alpha = null;

	}

}

class M2Material {

	constructor() {

		this.flags = 0;
		this.blendingMode = 0;

	}

}

class M2SkinSection {

	constructor() {

		this.skinSectionId = 0;
		this.Level = 0;
		this.vertexStart = 0;
		this.vertexCount = 0;
		this.indexStart = 0;
		this.indexCount = 0;
		this.boneCount = 0;
		this.boneComboIndex = 0;
		this.boneInfluences = 0;
		this.centerBoneIndex = 0;
		this.centerPosition = new Vector3();
		this.sortCenterPosition = new Vector3();
		this.sortRadius = 0;

	}

}

class M2Texture {

	constructor() {

		this.type = 0;
		this.flags = 0;
		this.filename = '';

	}

}

class M2TextureTransform {

	constructor() {

		this.translation = null;
		this.rotation = null;
		this.scale = null;

	}

}

class M2Track {

	constructor() {

		this.interpolationType = 0;
		this.globalSequence = 0;
		this.timestamps = [];
		this.values = [];

	}

}

class M2Vertex {

	constructor() {

		this.pos = new Vector3();
		this.boneWeights = [];
		this.boneIndices = [];
		this.normal = new Vector3();
		this.texCoords = [ new Vector2(), new Vector2() ];

	}

}

function int16ToFloat( x ) {

	return ( x < 0 ? x + 32768 : x - 32767 ) / 32767;

}

// JSDoc

/**
 * onLoad callback
 *
 * @callback onLoad
 * @param {THREE.Group} object - The result object.
 */

/**
 * onProgress callback
 *
 * @callback onProgress
 * @param {ProgressEvent} event - The progress event.
 */

/**
 * onError callback
 *
 * @callback onError
 * @param {Error} error - The error object.
 */

export { M2Loader };
