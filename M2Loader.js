import {
	AdditiveBlending,
	AnimationClip,
	Bone,
	Box3,
	BufferGeometry,
	Color,
	ColorKeyframeTrack,
	CompressedTexture,
	DataTexture,
	DoubleSide,
	FileLoader,
	Float32BufferAttribute,
	FrontSide,
	Group,
	InterpolateLinear,
	InterpolateSmooth,
	InterpolateDiscrete,
	LinearFilter,
	LinearMipmapLinearFilter,
	Loader,
	LoaderUtils,
	Mesh,
	MeshBasicMaterial,
	MeshLambertMaterial,
	NumberKeyframeTrack,
	Quaternion,
	QuaternionKeyframeTrack,
	RepeatWrapping,
	RGBA_S3TC_DXT1_Format,
	RGBA_S3TC_DXT3_Format,
	RGBA_S3TC_DXT5_Format,
	RGBA_BPTC_Format,
	Skeleton,
	SkinnedMesh,
	SRGBColorSpace,
	Uint8BufferAttribute,
	Vector2,
	Vector3,
	Vector4,
	VectorKeyframeTrack,
	AnimationMixer
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

				this.parse( buffer, url ).then( onLoad );

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
	*/
	async parse( buffer, url ) {

		const parser = new BinaryParser( buffer );
		const resourcePath = LoaderUtils.extractUrlBase( url );

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
		const sequences = this._readSequences( parser, header );
		const globalSequences = this._readGlobalSequences( parser, header );

		const sequenceManager = new SequenceManager( sequences, globalSequences, name, resourcePath );

		const colorDefinitions = this._readColorDefinitions( parser, header, sequenceManager );
		const materialDefinitions = this._readMaterialDefinitions( parser, header );
		const textureDefinitions = this._readTextureDefinitions( parser, header );
		const textureTransformDefinitions = this._readTextureTransformDefinitions( parser, header, sequenceManager );
		const textureWeightDefinitions = this._readTextureWeightDefinitions( parser, header, sequenceManager );
		const boneDefinitions = this._readBoneDefinitions( parser, header, sequenceManager );

		// lookup tables

		const lookupTables = {};
		lookupTables.bones = this._readBoneLookupTable( parser, header );
		lookupTables.textures = this._readTextureLookupTable( parser, header );
		lookupTables.textureTransforms = this._readTextureTransformsLookupTable( parser, header );
		lookupTables.textureWeights = this._readTextureWeightsLookupTable( parser, header );

		// loaders

		const textureLoader = new BLPLoader( this.manager );
		textureLoader.setPath( resourcePath );
		textureLoader.setHeader( header );

		const skinLoader = new M2SkinLoader( this.manager );
		skinLoader.setPath( resourcePath );
		skinLoader.setHeader( header );

		// load textures and skin data asynchronously

		const textures = await Promise.all( this._loadTextures( textureDefinitions, textureLoader, name, chunks ) );
		const skinData = await this._loadSkin( header, parser, skinLoader, name, chunks );

		// build scene

		const geometries = this._buildGeometries( skinData, vertices );
		const skeletonData = this._buildSkeleton( boneDefinitions, sequenceManager );
		const materials = this._buildMaterials( materialDefinitions );
		const textureTransforms = this._buildTextureTransforms( textureTransformDefinitions );
		const textureWeights = this._buildTextureWeights( textureWeightDefinitions );
		const colors = this._buildColors( colorDefinitions );
		const group = this._buildObjects( name, geometries, skeletonData, materials, colors, textures, textureTransforms, textureWeights, skinData, lookupTables, sequenceManager );

		group.userData.sequenceManager = sequenceManager;

		return group;

	}

	_buildObjects( name, geometries, skeletonData, materials, colors, textures, textureTransforms, textureWeights, skinData, lookupTables, sequenceManager ) {

		const group = new Group();
		group.name = name;

		const skeleton = skeletonData.skeleton;

		// meshes

		const batches = skinData.batches;

		for ( let i = 0; i < batches.length; i ++ ) {

			const batch = batches[ i ];

			const geometry = geometries[ batch.skinSectionIndex ];
			const material = materials[ batch.materialIndex ].clone(); // cloning is required since the same material might be animated differently

			// texture

			const textureIndex = lookupTables.textures[ batch.textureComboIndex ];

			if ( textureIndex !== undefined ) {

				material.map = textures[ textureIndex ].clone(); // cloning is required since the same texture might be animated differently

			}

			// texture transform animations

			const textureTransformIndex = lookupTables.textureTransforms[ batch.textureTransformComboIndex ];

			if ( textureTransformIndex !== undefined ) {

				const data = textureTransforms[ textureTransformIndex ];

				if ( data !== undefined ) {

					const translation = data.translation;
					const rotation = data.rotation;

					if ( translation.animated === false ) {

						material.map.offset.copy( translation.constant );

					}

					if ( rotation.animated === false ) {

						material.map.rotation = rotation.constant;

					}

					if ( translation.animated || rotation.animated ) {

						const tracks = data.tracks;
						const globalTracks = data.globalTracks;

						for ( let j = 0; j < tracks.length; j ++ ) {

							if ( tracks[ j ] === undefined ) continue;

							const clip = new AnimationClip( 'TextureTransform_' + j, - 1, [ ...tracks[ j ] ] );
							sequenceManager.addAnimationToSequence( clip, material.map, j );

						}

						for ( let j = 0; j < globalTracks.length; j ++ ) {

							if ( globalTracks[ j ] === undefined ) continue;

							const clip = new AnimationClip( 'GlobalTextureTransform_' + j, - 1, [ ...globalTracks[ j ] ] );
							sequenceManager.addAnimationToGlobalSequence( clip, material.map, j );

						}

					}

				}

			}

			// texture weight

			const textureWeightIndex = lookupTables.textureWeights[ batch.textureWeightComboIndex ];

			if ( textureWeightIndex !== undefined ) {

				const data = textureWeights[ textureWeightIndex ];

				if ( data !== undefined ) {

					const weight = data.weight;

					if ( weight.animated === false ) {

						material.opacity *= weight.constant;

					} else {

						const tracks = data.tracks;
						const globalTracks = data.globalTracks;

						for ( let j = 0; j < tracks.length; j ++ ) {

							if ( tracks[ j ] === undefined ) continue;

							const clip = new AnimationClip( 'Opacity_' + j, - 1, [ ...tracks[ j ] ] );
							sequenceManager.addAnimationToSequence( clip, material, j );

						}

						for ( let j = 0; j < globalTracks.length; j ++ ) {

							if ( globalTracks[ j ] === undefined ) continue;

							const clip = new AnimationClip( 'GlobalOpacity_' + j, - 1, [ ...globalTracks[ j ] ] );
							sequenceManager.addAnimationToGlobalSequence( clip, material, j );

						}

					}

				}

			}

			// color and alpha

			const colorData = colors[ batch.colorIndex ];

			if ( colorData !== undefined ) {

				const color = colorData.color;
				const alpha = colorData.alpha;

				if ( color.animated === false ) {

					material.color.copy( color.constant );

				}

				if ( alpha.animated === false ) {

					material.opacity *= alpha.constant;

				}

				if ( color.animated || alpha.animated ) {

					for ( let j = 0; j < colorData.tracks.length; j ++ ) {

						const tracks = colorData.tracks[ j ];

						if ( tracks === undefined ) continue;

						const clip = new AnimationClip( 'ColorAndAlpha_' + j, - 1, [ ... tracks ] );
						sequenceManager.addAnimationToSequence( clip, material, j );

					}

					for ( let j = 0; j < colorData.globalTracks.length; j ++ ) {

						const globalTracks = colorData.globalTracks[ j ];

						if ( globalTracks === undefined ) continue;

						const clip = new AnimationClip( 'GlobalColorAndAlpha_' + j, - 1, [ ... globalTracks ] );
						sequenceManager.addAnimationToGlobalSequence( clip, material, j );

					}

				}

			}

			// mesh

			let mesh;

			if ( skeleton !== null ) {

				mesh = new SkinnedMesh( geometry, material );
				mesh.bind( skeleton );

			} else {

				mesh = new Mesh( geometry, material );

			}

			group.add( mesh );

		}

		// skeleton

		if ( skeleton !== null ) {

			// bones must be part of the scene hierarchy

			for ( const bone of skeleton.bones ) {

				if ( bone.parent === null ) group.add( bone );

			}

			// animations

			const tracks = skeletonData.tracks;
			const globalTracks = skeletonData.globalTracks;

			for ( let j = 0; j < tracks.length; j ++ ) {

				if ( tracks[ j ] === undefined ) continue;

				const clip = new AnimationClip( 'SkeletonAnimation_' + j, - 1, [ ... tracks[ j ] ] );
				sequenceManager.addAnimationToSequence( clip, group, j );

			}

			for ( let j = 0; j < globalTracks.length; j ++ ) {

				if ( globalTracks[ j ] === undefined ) continue;

				const clip = new AnimationClip( 'GlobalSkeletonAnimation_' + j, - 1, [ ... globalTracks[ j ] ] );
				sequenceManager.addAnimationToGlobalSequence( clip, group, j );

			}

		}

		return group;

	}

	_buildColors( colorDefinitions ) {

		const colors = [];

		for ( let i = 0; i < colorDefinitions.length; i ++ ) {

			const colorDefinition = colorDefinitions[ i ];

			if ( colorDefinition !== undefined ) {

				const data = {
					color: {
						constant: new Color(),
						animated: true
					},
					alpha: {
						constant: 1,
						animated: true
					},
					tracks: [],
					globalTracks: [],
				};

				const color = colorDefinition.color;
				const alpha = colorDefinition.alpha;

				if ( isStaticTrack( color ) ) {

					data.color.constant.fromArray( color.values[ 0 ] );
					data.color.animated = false;

				} else {

					for ( let j = 0; j < color.timestamps.length; j ++ ) {

						const times = color.timestamps[ j ];
						const values = color.values[ j ];

						// ignore empty tracks

						if ( times.length === 0 ) {

							data.tracks[ j ] = [];
							continue;

						}

						// interpolation type

						const interpolation = getInterpolation( color.interpolationType );

						// keyframe track

						if ( color.globalSequence >= 0 ) {

							if ( data.globalTracks[ color.globalSequence ] === undefined ) data.globalTracks[ color.globalSequence ] = [];

							data.globalTracks[ color.globalSequence ].push( new ColorKeyframeTrack( '.color', times, values, interpolation ) );


						} else {

							if ( data.tracks[ j ] === undefined ) data.tracks[ j ] = [];

							data.tracks[ j ].push( new ColorKeyframeTrack( '.color', times, values, interpolation ) );

						}

					}

				}

				if ( isStaticTrack( alpha ) ) {

					data.alpha.constant = alpha.values[ 0 ][ 0 ];
					data.alpha.animated = false;

				} else {

					for ( let j = 0; j < alpha.timestamps.length; j ++ ) {

						const times = alpha.timestamps[ j ];
						const values = alpha.values[ j ];

						// ignore empty tracks

						if ( times.length === 0 ) {

							data.tracks[ j ] = [];
							continue;

						}

						// interpolation type

						const interpolation = getInterpolation( alpha.interpolationType );

						// keyframe track

						if ( alpha.globalSequence >= 0 ) {

							if ( data.globalTracks[ alpha.globalSequence ] === undefined ) data.globalTracks[ alpha.globalSequence ] = [];

							data.globalTracks[ alpha.globalSequence ].push( new NumberKeyframeTrack( '.opacity', times, values, interpolation ) );


						} else {

							if ( data.tracks[ j ] === undefined ) data.tracks[ j ] = [];

							data.tracks[ j ].push( new NumberKeyframeTrack( '.opacity', times, values, interpolation ) );

						}

					}

				}

				colors.push( data );

			}

		}

		return colors;

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
		const skinIndex = [];
		const skinWeight = [];

		for ( let i = 0; i < localVertexList.length; i ++ ) {

			const vertexIndex = localVertexList[ i ];
			const vertex = vertices[ vertexIndex ];

			// TODO: Implement up-axis conversion (z-up to y-up), figure out if WoW is left- or right-handed

			position.push( vertex.pos.x, vertex.pos.y, vertex.pos.z );
			normal.push( vertex.normal.x, vertex.normal.y, vertex.normal.z );
			uv.push( vertex.texCoords[ 0 ].x, vertex.texCoords[ 0 ].y );
			skinIndex.push( vertex.boneIndices.x, vertex.boneIndices.y, vertex.boneIndices.z, vertex.boneIndices.w );
			skinWeight.push( vertex.boneWeights.x, vertex.boneWeights.y, vertex.boneWeights.z, vertex.boneWeights.w );

		}

		const positionAttribute = new Float32BufferAttribute( position, 3 );
		const normalAttribute = new Float32BufferAttribute( normal, 3 );
		const uvAttribute = new Float32BufferAttribute( uv, 2 );
		const skinIndexAttribute = new Uint8BufferAttribute( skinIndex, 4 );
		const skinWeightAttribute = new Uint8BufferAttribute( skinWeight, 4, true );

		// geometries

		const geometries = [];

		for ( let i = 0; i < submeshes.length; i ++ ) {

			const submesh = submeshes[ i ];

			const index = indices.slice( submesh.indexStart, submesh.indexStart + submesh.indexCount );

			const geometry = new BufferGeometry();
			geometry.setAttribute( 'position', positionAttribute );
			geometry.setAttribute( 'normal', normalAttribute );
			geometry.setAttribute( 'uv', uvAttribute );
			geometry.setAttribute( 'skinIndex', skinIndexAttribute );
			geometry.setAttribute( 'skinWeight', skinWeightAttribute );
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

				case M2_BLEND_ADD:
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

	_buildSkeleton( boneDefinitions, sequenceManager ) {

		const data = {
			tracks: [],
			globalTracks: [],
			skeleton: null
		};

		// TODO: Find out a better way for detecting static models
		// Problem: Even static models might have bone definitions

		if ( boneDefinitions.length < 8 ) return data;

		const bones = [];

		for ( let i = 0; i < boneDefinitions.length; i ++ ) {

			const boneDefinition = boneDefinitions[ i ];

			const bone = new PivotBone();
			bone.pivot.copy( boneDefinition.pivot ); // three.js does not support pivot points so a custom bone class is required

			bones.push( bone );

			// build hierarchy

			const parentIndex = boneDefinition.parentBone;
			if ( parentIndex !== - 1 ) bones[ parentIndex ].add( bone );

			// animations

			const translationData = boneDefinition.translation;
			const rotationData = boneDefinition.rotation;
			const scaleData = boneDefinition.scale;

			for ( let j = 0; j < translationData.timestamps.length; j ++ ) {

				const times = translationData.timestamps[ j ];
				const values = translationData.values[ j ];

				// ignore empty tracks

				if ( times.length === 0 ) continue;

				// interpolation type

				const interpolation = getInterpolation( translationData.interpolationType );

				// keyframe track

				let track;

				if ( translationData.globalSequence >= 0 ) {

					if ( data.globalTracks[ translationData.globalSequence ] === undefined ) data.globalTracks[ translationData.globalSequence ] = [];

					track = new VectorKeyframeTrack( bone.uuid + '.position', times, values, interpolation );

					data.globalTracks[ translationData.globalSequence ].push( track );


				} else {

					if ( data.tracks[ j ] === undefined ) data.tracks[ j ] = [];

					track = new VectorKeyframeTrack( bone.uuid + '.position', times, values, interpolation );

					data.tracks[ j ].push( track );

				}

				// external data

				const externalTimestamps = translationData.externalTimestamps[ j ];
				const externalValues = translationData.externalValues[ j ];

				if ( externalTimestamps !== undefined ) {

					const sequence = sequenceManager.sequences[ j ];

					sequenceManager.addExternalTrack( sequence.id, sequence.variationIndex, externalTimestamps, externalValues, track );

				}

			}

			for ( let j = 0; j < rotationData.timestamps.length; j ++ ) {

				const times = rotationData.timestamps[ j ];
				const values = rotationData.values[ j ];

				// ignore empty tracks

				if ( times.length === 0 ) continue;

				// interpolation type

				const interpolation = getInterpolation( rotationData.interpolationType );

				// keyframe track

				let track;

				if ( rotationData.globalSequence >= 0 ) {

					if ( data.globalTracks[ rotationData.globalSequence ] === undefined ) data.globalTracks[ rotationData.globalSequence ] = [];

					track = new QuaternionKeyframeTrack( bone.uuid + '.quaternion', times, values, interpolation );

					data.globalTracks[ rotationData.globalSequence ].push( track );


				} else {

					if ( data.tracks[ j ] === undefined ) data.tracks[ j ] = [];

					track = new QuaternionKeyframeTrack( bone.uuid + '.quaternion', times, values, interpolation );

					data.tracks[ j ].push( track );

				}

				// external data

				const externalTimestamps = rotationData.externalTimestamps[ j ];
				const externalValues = rotationData.externalValues[ j ];

				if ( externalTimestamps !== undefined ) {

					const sequence = sequenceManager.sequences[ j ];

					sequenceManager.addExternalTrack( sequence.id, sequence.variationIndex, externalTimestamps, externalValues, track );

				}

			}

			for ( let j = 0; j < scaleData.timestamps.length; j ++ ) {

				const times = scaleData.timestamps[ j ];
				const values = scaleData.values[ j ];

				// ignore empty tracks

				if ( times.length === 0 ) continue;

				// interpolation type

				const interpolation = getInterpolation( scaleData.interpolationType );

				// keyframe track

				let track;

				if ( scaleData.globalSequence >= 0 ) {

					if ( data.globalTracks[ scaleData.globalSequence ] === undefined ) data.globalTracks[ scaleData.globalSequence ] = [];

					track = new VectorKeyframeTrack( bone.uuid + '.scale', times, values, interpolation );

					data.globalTracks[ scaleData.globalSequence ].push( track );


				} else {

					if ( data.tracks[ j ] === undefined ) data.tracks[ j ] = [];

					track = new VectorKeyframeTrack( bone.uuid + '.scale', times, values, interpolation );

					data.tracks[ j ].push( track );

				}

				// external data

				const externalTimestamps = scaleData.externalTimestamps[ j ];
				const externalValues = scaleData.externalValues[ j ];

				if ( externalTimestamps !== undefined ) {

					const sequence = sequenceManager.sequences[ j ];

					sequenceManager.addExternalTrack( sequence.id, sequence.variationIndex, externalTimestamps, externalValues, track );

				}


			}

		}

		data.skeleton = new Skeleton( bones );

		return data;

	}

	_buildTextureTransforms( textureTransformDefinitions ) {

		const textureTransforms = [];

		for ( let i = 0; i < textureTransformDefinitions.length; i ++ ) {

			const textureTransformDefinition = textureTransformDefinitions[ i ];

			const data = {
				translation: {
					constant: new Vector2(),
					animated: true
				},
				rotation: {
					constant: 1,
					animated: true
				},
				tracks: [],
				globalTracks: [],
			};

			const translation = textureTransformDefinition.translation;
			const rotation = textureTransformDefinition.rotation;

			// translation

			if ( isStaticTrack( translation ) ) {

				data.translation.constant.copy( translation.values[ 0 ] );
				data.translation.animated = false;

			} else {

				for ( let j = 0; j < translation.timestamps.length; j ++ ) {

					const times = translation.timestamps[ j ];
					const vi = translation.values[ j ];

					const values = [];

					// ignore empty tracks

					if ( times.length === 0 ) {

						data.tracks[ j ] = [];
						continue;

					}

					// values

					for ( let k = 0; k < vi.length; k += 3 ) {

						// extract x,y, ignore z

						values.push( vi[ k ] );
						values.push( vi[ k + 1 ] );

					}

					// interpolation type

					const interpolation = getInterpolation( translation.interpolationType );

					// keyframe track

					if ( translation.globalSequence >= 0 ) {

						if ( data.globalTracks[ translation.globalSequence ] === undefined ) data.globalTracks[ translation.globalSequence ] = [];

						data.globalTracks[ translation.globalSequence ].push( new VectorKeyframeTrack( '.offset', times, values, interpolation ) );


					} else {

						if ( data.tracks[ j ] === undefined ) data.tracks[ j ] = [];

						data.tracks[ j ].push( new VectorKeyframeTrack( '.offset', times, values, interpolation ) );

					}

				}

			}

			// rotation

			const q = new Quaternion();

			if ( isStaticTrack( rotation ) ) {

				q.fromArray( rotation.values[ 0 ] );
				data.rotation.constant = quaternionToAngle( q, 0 );
				data.rotation.animated = false;

			} else {

				for ( let j = 0; j < rotation.timestamps.length; j ++ ) {

					const times = rotation.timestamps[ j ];
					const vi = rotation.values[ j ];

					const values = [];

					// ignore empty tracks

					if ( times.length === 0 ) {

						data.tracks[ j ] = [];
						continue;

					}

					// values

					let r = 0;

					for ( let k = 0; k < vi.length; k += 4 ) {

						// M2 uses a sequence of quaternions to represent texture rotation. in three.js this must be converted to a sequence of angles.

						q.fromArray( vi, k );
						r = quaternionToAngle( q, r );
						values.push( r );

					}

					// interpolation type

					const interpolation = getInterpolation( rotation.interpolationType );

					// keyframe track

					if ( rotation.globalSequence >= 0 ) {

						if ( data.globalTracks[ rotation.globalSequence ] === undefined ) data.globalTracks[ rotation.globalSequence ] = [];

						data.globalTracks[ rotation.globalSequence ].push( new NumberKeyframeTrack( '.rotation', times, values, interpolation ) );


					} else {

						if ( data.tracks[ j ] === undefined ) data.tracks[ j ] = [];

						data.tracks[ j ].push( new NumberKeyframeTrack( '.rotation', times, values, interpolation ) );

					}

				}

			}

			textureTransforms.push( data );

		}

		return textureTransforms;

	}

	_buildTextureWeights( textureWeightDefinitions ) {

		const textureWeights = [];

		for ( let i = 0; i < textureWeightDefinitions.length; i ++ ) {

			const textureWeightDefinition = textureWeightDefinitions[ i ];

			const data = {
				weight: {
					constant: 1,
					animated: true
				},
				tracks: [],
				globalTracks: []
			};

			if ( isStaticTrack( textureWeightDefinition ) ) {

				data.weight.constant = textureWeightDefinition.values[ 0 ][ 0 ];
				data.weight.animated = false;

			} else {

				for ( let j = 0; j < textureWeightDefinition.timestamps.length; j ++ ) {

					const times = textureWeightDefinition.timestamps[ j ];
					const values = textureWeightDefinition.values[ j ];

					// ignore empty tracks

					if ( times.length === 0 ) {

						data.tracks[ j ] = [];
						continue;

					}

					// interpolation type

					const interpolation = getInterpolation( textureWeightDefinition.interpolationType );

					// keyframe track

					if ( textureWeightDefinition.globalSequence >= 0 ) {

						if ( data.globalTracks[ textureWeightDefinition.globalSequence ] === undefined ) data.globalTracks[ textureWeightDefinition.globalSequence ] = [];

						data.globalTracks[ textureWeightDefinition.globalSequence ].push( new NumberKeyframeTrack( '.opacity', times, values, interpolation ) );

					} else {

						if ( data.tracks[ j ] === undefined ) data.tracks[ j ] = [];

						data.tracks[ j ].push( new NumberKeyframeTrack( '.opacity', times, values, interpolation ) );

					}

				}

			}

			textureWeights.push( data );

		}

		return textureWeights;

	}

	_loadSkin( header, parser, skinLoader, name, chunks ) {

		let promise;

		if ( header.version <= M2_VERSION_THE_BURNING_CRUSADE ) {

			promise = Promise.resolve( this._readEmbeddedSkinData( parser, header ) );

		} else {

			let filename = ( name + '00.skin' ).toLowerCase(); // default skin name based on .m2 file

			const skinFileDataIDs = chunks.get( 'SFID' );

			if ( skinFileDataIDs !== undefined ) {

				filename = skinFileDataIDs[ 0 ] + '.skin';

			}

			promise = new Promise( ( resolve, reject ) => {

				skinLoader.load( filename, resolve, undefined, () => {

					reject( new Error( 'THREE.M2Loader: Failed to load skin file: ' + filename ) );

				} );

			} );

		}

		return promise;

	}

	_loadTextures( textureDefinitions, loader, name, chunks ) {

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

	_readBoneDefinition( parser, header, sequenceManager ) {

		const bone = new M2Bone();

		bone.keyBoneId = parser.readInt32();
		bone.flags = parser.readUInt32();
		bone.parentBone = parser.readInt16();
		bone.submeshId = parser.readUInt16();
		bone.boneNameCRC = parser.readUInt32();

		bone.translation = this._readTrack( parser, header, 'vec3', sequenceManager );
		bone.rotation = this._readTrack( parser, header, 'quatCompressed', sequenceManager );
		bone.scale = this._readTrack( parser, header, 'vec3', sequenceManager );

		bone.pivot.set(
			parser.readFloat32(),
			parser.readFloat32(),
			parser.readFloat32()
		);

		return bone;

	}

	_readBoneDefinitions( parser, header, sequenceManager ) {

		const length = header.bonesLength;
		const offset = header.bonesOffset;

		parser.saveState();
		parser.moveTo( offset );

		const bones = [];

		for ( let i = 0; i < length; i ++ ) {

			const bone = this._readBoneDefinition( parser, header, sequenceManager );
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

	_readColorDefinitions( parser, header, sequenceManager ) {

		const length = header.colorsLength;
		const offset = header.colorsOffset;

		parser.saveState();
		parser.moveTo( offset );

		const colors = [];

		for ( let i = 0; i < length; i ++ ) {

			const color = new M2Color();

			color.color = this._readTrack( parser, header, 'vec3', sequenceManager );
			color.alpha = this._readTrack( parser, header, 'fixed16', sequenceManager );

			colors.push( color );

		}

		parser.restoreState();

		return colors;

	}

	_readEmbeddedSkinData( parser, header ) {

		const offset = header.skinProfilesOffset;

		parser.saveState();
		parser.moveTo( offset );

		const loader = new M2SkinLoader();
		const skinData = loader.read( parser, header );

		parser.restoreState();

		return skinData;

	}

	_readGlobalSequences( parser, header ) {

		const length = header.globalLoopsLength;
		const offset = header.globalLoopsOffset;

		parser.saveState();
		parser.moveTo( offset );

		const timestamps = [];

		for ( let i = 0; i < length; i ++ ) {

			timestamps.push( parser.readUInt32() );

		}

		parser.restoreState();

		return timestamps;

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

	_readSequences( parser, header ) {

		const length = header.sequencesLength;
		const offset = header.sequencesOffset;

		parser.saveState();
		parser.moveTo( offset );

		const sequences = [];

		for ( let i = 0; i < length; i ++ ) {

			const sequence = new M2Sequence();

			sequence.id = parser.readUInt16();
			sequence.variationIndex = parser.readUInt16();

			if ( header.version <= M2_VERSION_THE_BURNING_CRUSADE ) {

				sequence.startTimestamp = parser.readUInt32();
				sequence.endTimestamp = parser.readUInt32();

			} else {

				sequence.duration = parser.readUInt32();

			}

			sequence.movespeed = parser.readFloat32();
			sequence.flags = parser.readUInt32();
			sequence.frequency = parser.readInt16();
			sequence.padding = parser.readUInt16();
			sequence.replay.minimum = parser.readUInt32();
			sequence.replay.maximum = parser.readUInt32();

			if ( header.version < M2_VERSION_LEGION ) {

				sequence.blendTime = parser.readUInt32();

			} else {

				sequence.blendTimeIn = parser.readUInt16();
				sequence.blendTimeOut = parser.readUInt16();

			}

			sequence.bounds.extend.max.set( parser.readFloat32(), parser.readFloat32(), parser.readFloat32() );
			sequence.bounds.extend.min.set( parser.readFloat32(), parser.readFloat32(), parser.readFloat32() );
			sequence.bounds.radius = parser.readFloat32();

			sequence.variationNext = parser.readInt16();
			sequence.aliasNext = parser.readUInt16();

			sequences.push( sequence );

		}

		parser.restoreState();

		return sequences;

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

	_readTextureTransformDefinitions( parser, header, sequenceManager ) {

		const length = header.textureTransformsLength;
		const offset = header.textureTransformsOffset;

		parser.saveState();
		parser.moveTo( offset );

		const textureTransforms = [];

		for ( let i = 0; i < length; i ++ ) {

			const textureTransform = this._readTextureTransformDefinition( parser, header, sequenceManager );
			textureTransforms.push( textureTransform );

		}

		parser.restoreState();

		return textureTransforms;


	}

	_readTextureTransformDefinition( parser, header, sequenceManager ) {

		const textureTransform = new M2TextureTransform();

		textureTransform.translation = this._readTrack( parser, header, 'vec3', sequenceManager );
		textureTransform.rotation = this._readTrack( parser, header, 'quat', sequenceManager );
		textureTransform.scale = this._readTrack( parser, header, 'vec3', sequenceManager );

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

	_readTextureWeightDefinitions( parser, header, sequenceManager ) {

		const length = header.textureWeightsLength;
		const offset = header.textureWeightsOffset;

		parser.saveState();
		parser.moveTo( offset );

		const textureWeights = [];

		for ( let i = 0; i < length; i ++ ) {

			const track = this._readTrack( parser, header, 'fixed16', sequenceManager );

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

	_readTrack( parser, header, type, sequenceManager ) {

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

				const length = parser.readUInt32();
				const offset = parser.readUInt32();

				let values = new Array( length );

				if ( sequenceManager.isEmbeddedSequence( i ) ) {

					extractTimestamps( parser, length, offset, values );

				} else {

					values = values.fill( 0 );

					track.externalTimestamps[ i ] = {
						length,
						offset,
					};

				}

				track.timestamps.push( values );

			}

			parser.restoreState();

			// values

			const valuesLength = parser.readUInt32();
			const valuesOffset = parser.readUInt32();

			parser.saveState();
			parser.moveTo( valuesOffset );

			for ( let i = 0; i < valuesLength; i ++ ) {

				const length = parser.readUInt32();
				const offset = parser.readUInt32();

				const itemSize = getItemSize( type );
				let values = new Array( length * itemSize );

				if ( sequenceManager.isEmbeddedSequence( i ) ) {

					extractValues( parser, length, offset, type, itemSize, values );

				} else {

					values = values.fill( 0 );

					track.externalValues[ i ] = {
						length,
						offset,
						type,
						itemSize
					};

				}

				track.values.push( values );

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

		vertex.boneWeights.x = parser.readUInt8();
		vertex.boneWeights.y = parser.readUInt8();
		vertex.boneWeights.z = parser.readUInt8();
		vertex.boneWeights.w = parser.readUInt8();

		vertex.boneIndices.x = parser.readUInt8();
		vertex.boneIndices.y = parser.readUInt8();
		vertex.boneIndices.z = parser.readUInt8();
		vertex.boneIndices.w = parser.readUInt8();

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

//

function extractTimestamps( parser, length, offset, values ) {

	parser.saveState();
	parser.moveTo( offset );

	for ( let j = 0; j < length; j ++ ) {

		values[ j ] = parser.readUInt32() / 1000;

	}

	parser.restoreState();

}

function extractValues( parser, length, offset, type, itemSize, values ) {

	parser.saveState();
	parser.moveTo( offset );

	for ( let j = 0; j < length; j ++ ) {

		const stride = j * itemSize;

		switch ( type ) {

			case 'fixed16':

				values[ stride ] = parser.readInt16() / 0x7fff;

				break;

			case 'vec2':

				values[ stride + 0 ] = parser.readFloat32();
				values[ stride + 1 ] = parser.readFloat32();

				break;

			case 'vec3':

				values[ stride + 0 ] = parser.readFloat32();
				values[ stride + 1 ] = parser.readFloat32();
				values[ stride + 2 ] = parser.readFloat32();

				break;

			case 'quatCompressed':

				// conversion from short to float, see https://wowdev.wiki/Quaternion_values_and_2.x

				let x = parser.readInt16();
				let y = parser.readInt16();
				let z = parser.readInt16();
				let w = parser.readInt16();

				x = ( x < 0 ? x + 32768 : x - 32767 ) / 32767;
				y = ( y < 0 ? y + 32768 : y - 32767 ) / 32767;
				z = ( z < 0 ? z + 32768 : z - 32767 ) / 32767;
				w = ( w < 0 ? w + 32768 : w - 32767 ) / 32767;

				values[ stride + 0 ] = x;
				values[ stride + 1 ] = y;
				values[ stride + 2 ] = z;
				values[ stride + 3 ] = w;

				break;

			case 'quat':

				values[ stride + 0 ] = parser.readFloat32();
				values[ stride + 1 ] = parser.readFloat32();
				values[ stride + 2 ] = parser.readFloat32();
				values[ stride + 3 ] = parser.readFloat32();

				break;

			default:

				console.error( 'THREE.M2Loader: Unsupported item type:', type );
				break;

		}

	}

	parser.restoreState();

}


function getInterpolation( type ) {

	let interpolation;

	switch ( type ) {

		case 0:
			interpolation = InterpolateDiscrete;
			break;

		case 1:
			interpolation = InterpolateLinear;
			break;

		case 2:
		case 3:
			interpolation = InterpolateSmooth;
			break;

		default:
			console.warn( 'THREE.M2Loader: Unsupported interpolation type:', type );
			interpolation = InterpolateLinear; // fallback
			break;

	}

	return interpolation;

}

function getItemSize( type ) {

	let size = - 1;

	switch ( type ) {

		case 'fixed16':

			size = 1;
			break;

		case 'vec2':

			size = 2;
			break;

		case 'vec3':

			size = 3;
			break;

		case 'quat':
		case 'quatCompressed':

			size = 4;
			break;

		default:
			console.error( 'THREE.M2Loader: Unsupported item type:', type );
			size = 0;
			break;

	}

	return size;

}

function isStaticTrack( track ) {

	// used to detect static tracks (tracks with a single timestamp array that holds just "0")

	return track.timestamps.length === 1 && track.timestamps[ 0 ].length === 1 && track.timestamps[ 0 ][ 0 ] === 0;

}

const v0 = new Vector3();
const v1 = new Vector3( 0, 1, 0 );
const up = new Vector3( 0, 0, - 1 );
const cross = new Vector3();

function quaternionToAngle( q, r ) {

	// TODO: Verify if this approach works with other assets than g_scourgerunecirclecrystal.m2

	v0.copy( v1 );
	v1.set( 0, 1, 0 ).applyQuaternion( q );

	const dot = v0.dot( v1 );
	const det = up.dot( cross.crossVectors( v0, v1 ) );
	r += Math.atan2( det, dot );

	return r;

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
const M2_VERSION_LEGION = 274;
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
const M2_BLEND_ADD = 4;

const M2_SEQUENCE_EMBEDDED_DATA = 0x20;

const M2_ANIMATION_LIST = [ "Stand", "Death", "Spell", "Stop", "Walk", "Run", "Dead", "Rise", "StandWound", "CombatWound", "CombatCritical", "ShuffleLeft", "ShuffleRight", "Walkbackwards", "Stun", "HandsClosed", "AttackUnarmed", "Attack1H", "Attack2H", "Attack2HL", "ParryUnarmed", "Parry1H", "Parry2H", "Parry2HL", "ShieldBlock", "ReadyUnarmed", "Ready1H", "Ready2H", "Ready2HL", "ReadyBow", "Dodge", "SpellPrecast", "SpellCast", "SpellCastArea", "NPCWelcome", "NPCGoodbye", "Block", "JumpStart", "Jump", "JumpEnd", "Fall", "SwimIdle", "Swim", "SwimLeft", "SwimRight", "SwimBackwards", "AttackBow", "FireBow", "ReadyRifle", "AttackRifle", "Loot", "ReadySpellDirected", "ReadySpellOmni", "SpellCastDirected", "SpellCastOmni", "BattleRoar", "ReadyAbility", "Special1H", "Special2H", "ShieldBash", "EmoteTalk", "EmoteEat", "EmoteWork", "EmoteUseStanding", "EmoteTalkExclamation", "EmoteTalkQuestion", "EmoteBow", "EmoteWave", "EmoteCheer", "EmoteDance", "EmoteLaugh", "EmoteSleep", "EmoteSitGround", "EmoteRude", "EmoteRoar", "EmoteKneel", "EmoteKiss", "EmoteCry", "EmoteChicken", "EmoteBeg", "EmoteApplaud", "EmoteShout", "EmoteFlex", "EmoteShy", "EmotePoint", "Attack1HPierce", "Attack2HLoosePierce", "AttackOff", "AttackOffPierce", "Sheath", "HipSheath", "Mount", "RunRight", "RunLeft", "MountSpecial", "Kick", "SitGroundDown", "SitGround", "SitGroundUp", "SleepDown", "Sleep", "SleepUp", "SitChairLow", "SitChairMed", "SitChairHigh", "LoadBow", "LoadRifle", "AttackThrown", "ReadyThrown", "HoldBow", "HoldRifle", "HoldThrown", "LoadThrown", "EmoteSalute", "KneelStart", "KneelLoop", "KneelEnd", "AttackUnarmedOff", "SpecialUnarmed", "StealthWalk", "StealthStand", "Knockdown", "EatingLoop", "UseStandingLoop", "ChannelCastDirected", "ChannelCastOmni", "Whirlwind", "Birth", "UseStandingStart", "UseStandingEnd", "CreatureSpecial", "Drown", "Drowned", "FishingCast", "FishingLoop", "Fly", "EmoteWorkNoSheathe", "EmoteStunNoSheathe", "EmoteUseStandingNoSheathe", "SpellSleepDown", "SpellKneelStart", "SpellKneelLoop", "SpellKneelEnd", "Sprint", "InFlight", "Spawn", "Close", "Closed", "Open", "Opened", "Destroy", "Destroyed", "Rebuild", "Custom0", "Custom1", "Custom2", "Custom3", "Despawn", "Hold", "Decay", "BowPull", "BowRelease", "ShipStart", "ShipMoving", "ShipStop", "GroupArrow", "Arrow", "CorpseArrow", "GuideArrow", "Sway", "DruidCatPounce", "DruidCatRip", "DruidCatRake", "DruidCatRavage", "DruidCatClaw", "DruidCatCower", "DruidBearSwipe", "DruidBearBite", "DruidBearMaul", "DruidBearBash", "DragonTail", "DragonStomp", "DragonSpit", "DragonSpitHover", "DragonSpitFly", "EmoteYes", "EmoteNo", "JumpLandRun", "LootHold", "LootUp", "StandHigh", "Impact", "LiftOff", "Hover", "SuccubusEntice", "EmoteTrain", "EmoteDead", "EmoteDanceOnce", "Deflect", "EmoteEatNoSheathe", "Land", "Submerge", "Submerged", "Cannibalize", "ArrowBirth", "GroupArrowBirth", "CorpseArrowBirth", "GuideArrowBirth", "EmoteTalkNoSheathe", "EmotePointNoSheathe", "EmoteSaluteNoSheathe", "EmoteDanceSpecial", "Mutilate", "CustomSpell01", "CustomSpell02", "CustomSpell03", "CustomSpell04", "CustomSpell05", "CustomSpell06", "CustomSpell07", "CustomSpell08", "CustomSpell09", "CustomSpell10", "StealthRun", "Emerge", "Cower", "Grab", "GrabClosed", "GrabThrown", "FlyStand", "FlyDeath", "FlySpell", "FlyStop", "FlyWalk", "FlyRun", "FlyDead", "FlyRise", "FlyStandWound", "FlyCombatWound", "FlyCombatCritical", "FlyShuffleLeft", "FlyShuffleRight", "FlyWalkbackwards", "FlyStun", "FlyHandsClosed", "FlyAttackUnarmed", "FlyAttack1H", "FlyAttack2H", "FlyAttack2HL", "FlyParryUnarmed", "FlyParry1H", "FlyParry2H", "FlyParry2HL", "FlyShieldBlock", "FlyReadyUnarmed", "FlyReady1H", "FlyReady2H", "FlyReady2HL", "FlyReadyBow", "FlyDodge", "FlySpellPrecast", "FlySpellCast", "FlySpellCastArea", "FlyNPCWelcome", "FlyNPCGoodbye", "FlyBlock", "FlyJumpStart", "FlyJump", "FlyJumpEnd", "FlyFall", "FlySwimIdle", "FlySwim", "FlySwimLeft", "FlySwimRight", "FlySwimBackwards", "FlyAttackBow", "FlyFireBow", "FlyReadyRifle", "FlyAttackRifle", "FlyLoot", "FlyReadySpellDirected", "FlyReadySpellOmni", "FlySpellCastDirected", "FlySpellCastOmni", "FlyBattleRoar", "FlyReadyAbility", "FlySpecial1H", "FlySpecial2H", "FlyShieldBash", "FlyEmoteTalk", "FlyEmoteEat", "FlyEmoteWork", "FlyEmoteUseStanding", "FlyEmoteTalkExclamation", "FlyEmoteTalkQuestion", "FlyEmoteBow", "FlyEmoteWave", "FlyEmoteCheer", "FlyEmoteDance", "FlyEmoteLaugh", "FlyEmoteSleep", "FlyEmoteSitGround", "FlyEmoteRude", "FlyEmoteRoar", "FlyEmoteKneel", "FlyEmoteKiss", "FlyEmoteCry", "FlyEmoteChicken", "FlyEmoteBeg", "FlyEmoteApplaud", "FlyEmoteShout", "FlyEmoteFlex", "FlyEmoteShy", "FlyEmotePoint", "FlyAttack1HPierce", "FlyAttack2HLoosePierce", "FlyAttackOff", "FlyAttackOffPierce", "FlySheath", "FlyHipSheath", "FlyMount", "FlyRunRight", "FlyRunLeft", "FlyMountSpecial", "FlyKick", "FlySitGroundDown", "FlySitGround", "FlySitGroundUp", "FlySleepDown", "FlySleep", "FlySleepUp", "FlySitChairLow", "FlySitChairMed", "FlySitChairHigh", "FlyLoadBow", "FlyLoadRifle", "FlyAttackThrown", "FlyReadyThrown", "FlyHoldBow", "FlyHoldRifle", "FlyHoldThrown", "FlyLoadThrown", "FlyEmoteSalute", "FlyKneelStart", "FlyKneelLoop", "FlyKneelEnd", "FlyAttackUnarmedOff", "FlySpecialUnarmed", "FlyStealthWalk", "FlyStealthStand", "FlyKnockdown", "FlyEatingLoop", "FlyUseStandingLoop", "FlyChannelCastDirected", "FlyChannelCastOmni", "FlyWhirlwind", "FlyBirth", "FlyUseStandingStart", "FlyUseStandingEnd", "FlyCreatureSpecial", "FlyDrown", "FlyDrowned", "FlyFishingCast", "FlyFishingLoop", "FlyFly",
	"FlyEmoteWorkNoSheathe", "FlyEmoteStunNoSheathe", "FlyEmoteUseStandingNoSheathe", "FlySpellSleepDown", "FlySpellKneelStart", "FlySpellKneelLoop", "FlySpellKneelEnd", "FlySprint", "FlyInFlight", "FlySpawn", "FlyClose", "FlyClosed", "FlyOpen", "FlyOpened", "FlyDestroy", "FlyDestroyed", "FlyRebuild", "FlyCustom0", "FlyCustom1", "FlyCustom2", "FlyCustom3", "FlyDespawn", "FlyHold", "FlyDecay", "FlyBowPull", "FlyBowRelease", "FlyShipStart", "FlyShipMoving", "FlyShipStop", "FlyGroupArrow", "FlyArrow", "FlyCorpseArrow", "FlyGuideArrow", "FlySway", "FlyDruidCatPounce", "FlyDruidCatRip", "FlyDruidCatRake", "FlyDruidCatRavage", "FlyDruidCatClaw", "FlyDruidCatCower", "FlyDruidBearSwipe", "FlyDruidBearBite", "FlyDruidBearMaul", "FlyDruidBearBash", "FlyDragonTail", "FlyDragonStomp", "FlyDragonSpit", "FlyDragonSpitHover", "FlyDragonSpitFly", "FlyEmoteYes", "FlyEmoteNo", "FlyJumpLandRun", "FlyLootHold", "FlyLootUp", "FlyStandHigh", "FlyImpact", "FlyLiftOff", "FlyHover", "FlySuccubusEntice", "FlyEmoteTrain", "FlyEmoteDead", "FlyEmoteDanceOnce", "FlyDeflect", "FlyEmoteEatNoSheathe", "FlyLand", "FlySubmerge", "FlySubmerged", "FlyCannibalize", "FlyArrowBirth", "FlyGroupArrowBirth", "FlyCorpseArrowBirth", "FlyGuideArrowBirth", "FlyEmoteTalkNoSheathe", "FlyEmotePointNoSheathe", "FlyEmoteSaluteNoSheathe", "FlyEmoteDanceSpecial", "FlyMutilate", "FlyCustomSpell01", "FlyCustomSpell02", "FlyCustomSpell03", "FlyCustomSpell04", "FlyCustomSpell05", "FlyCustomSpell06", "FlyCustomSpell07", "FlyCustomSpell08", "FlyCustomSpell09", "FlyCustomSpell10", "FlyStealthRun", "FlyEmerge", "FlyCower", "FlyGrab", "FlyGrabClosed", "FlyGrabThrown", "ToFly", "ToHover", "ToGround", "FlyToFly", "FlyToHover", "FlyToGround", "Settle", "FlySettle", "DeathStart", "DeathLoop", "DeathEnd", "FlyDeathStart", "FlyDeathLoop", "FlyDeathEnd", "DeathEndHold", "FlyDeathEndHold", "Strangulate", "FlyStrangulate", "ReadyJoust", "LoadJoust", "HoldJoust", "FlyReadyJoust", "FlyLoadJoust", "FlyHoldJoust", "AttackJoust", "FlyAttackJoust", "ReclinedMount", "FlyReclinedMount", "ToAltered", "FromAltered", "FlyToAltered", "FlyFromAltered", "InStocks", "FlyInStocks", "VehicleGrab", "VehicleThrow", "FlyVehicleGrab", "FlyVehicleThrow", "ToAlteredPostSwap", "FromAlteredPostSwap", "FlyToAlteredPostSwap", "FlyFromAlteredPostSwap", "ReclinedMountPassenger", "FlyReclinedMountPassenger", "Carry2H", "Carried2H", "FlyCarry2H", "FlyCarried2H", "EmoteSniff", "EmoteFlySniff", "AttackFist1H", "FlyAttackFist1H", "AttackFist1HOff", "FlyAttackFist1HOff", "ParryFist1H", "FlyParryFist1H", "ReadyFist1H", "FlyReadyFist1H", "SpecialFist1H", "FlySpecialFist1H", "EmoteReadStart", "FlyEmoteReadStart", "EmoteReadLoop", "FlyEmoteReadLoop", "EmoteReadEnd", "FlyEmoteReadEnd", "SwimRun", "FlySwimRun", "SwimWalk", "FlySwimWalk", "SwimWalkBackwards", "FlySwimWalkBackwards", "SwimSprint", "FlySwimSprint", "MountSwimIdle", "FlyMountSwimIdle", "MountSwimBackwards", "FlyMountSwimBackwards", "MountSwimLeft", "FlyMountSwimLeft", "MountSwimRight", "FlyMountSwimRight", "MountSwimRun", "FlyMountSwimRun", "MountSwimSprint", "FlyMountSwimSprint", "MountSwimWalk", "FlyMountSwimWalk", "MountSwimWalkBackwards", "FlyMountSwimWalkBackwards", "MountFlightIdle", "FlyMountFlightIdle", "MountFlightBackwards", "FlyMountFlightBackwards", "MountFlightLeft", "FlyMountFlightLeft", "MountFlightRight", "FlyMountFlightRight", "MountFlightRun", "FlyMountFlightRun", "MountFlightSprint", "FlyMountFlightSprint", "MountFlightWalk", "FlyMountFlightWalk", "MountFlightWalkBackwards", "FlyMountFlightWalkBackwards", "MountFlightStart", "FlyMountFlightStart", "MountSwimStart", "FlyMountSwimStart", "MountSwimLand", "FlyMountSwimLand", "MountSwimLandRun", "FlyMountSwimLandRun", "MountFlightLand", "FlyMountFlightLand", "MountFlightLandRun", "FlyMountFlightLandRun", "ReadyBlowDart", "FlyReadyBlowDart", "LoadBlowDart", "FlyLoadBlowDart", "HoldBlowDart", "FlyHoldBlowDart", "AttackBlowDart", "FlyAttackBlowDart", "CarriageMount", "FlyCarriageMount", "CarriagePassengerMount", "FlyCarriagePassengerMount", "CarriageMountAttack", "FlyCarriageMountAttack", "BarTendStand", "FlyBarTendStand", "BarServerWalk", "FlyBarServerWalk", "BarServerRun", "FlyBarServerRun", "BarServerShuffleLeft", "FlyBarServerShuffleLeft", "BarServerShuffleRight", "FlyBarServerShuffleRight", "BarTendEmoteTalk", "FlyBarTendEmoteTalk", "BarTendEmotePoint", "FlyBarTendEmotePoint", "BarServerStand", "FlyBarServerStand", "BarSweepWalk", "FlyBarSweepWalk", "BarSweepRun", "FlyBarSweepRun", "BarSweepShuffleLeft", "FlyBarSweepShuffleLeft", "BarSweepShuffleRight", "FlyBarSweepShuffleRight", "BarSweepEmoteTalk", "FlyBarSweepEmoteTalk", "BarPatronSitEmotePoint", "FlyBarPatronSitEmotePoint", "MountSelfIdle", "FlyMountSelfIdle", "MountSelfWalk", "FlyMountSelfWalk", "MountSelfRun", "FlyMountSelfRun", "MountSelfSprint", "FlyMountSelfSprint", "MountSelfRunLeft", "FlyMountSelfRunLeft", "MountSelfRunRight", "FlyMountSelfRunRight", "MountSelfShuffleLeft", "FlyMountSelfShuffleLeft", "MountSelfShuffleRight", "FlyMountSelfShuffleRight", "MountSelfWalkBackwards", "FlyMountSelfWalkBackwards", "MountSelfSpecial", "FlyMountSelfSpecial", "MountSelfJump", "FlyMountSelfJump", "MountSelfJumpStart", "FlyMountSelfJumpStart", "MountSelfJumpEnd", "FlyMountSelfJumpEnd", "MountSelfJumpLandRun", "FlyMountSelfJumpLandRun", "MountSelfStart", "FlyMountSelfStart", "MountSelfFall", "FlyMountSelfFall", "Stormstrike", "FlyStormstrike", "ReadyJoustNoSheathe", "FlyReadyJoustNoSheathe", "Slam", "FlySlam", "DeathStrike", "FlyDeathStrike",
	"SwimAttackUnarmed", "FlySwimAttackUnarmed", "SpinningKick", "FlySpinningKick", "RoundHouseKick", "FlyRoundHouseKick", "RollStart", "FlyRollStart", "Roll", "FlyRoll", "RollEnd", "FlyRollEnd", "PalmStrike", "FlyPalmStrike", "MonkOffenseAttackUnarmed", "FlyMonkOffenseAttackUnarmed", "MonkOffenseAttackUnarmedOff", "FlyMonkOffenseAttackUnarmedOff", "MonkOffenseParryUnarmed", "FlyMonkOffenseParryUnarmed", "MonkOffenseReadyUnarmed", "FlyMonkOffenseReadyUnarmed", "MonkOffenseSpecialUnarmed", "FlyMonkOffenseSpecialUnarmed", "MonkDefenseAttackUnarmed", "FlyMonkDefenseAttackUnarmed", "MonkDefenseAttackUnarmedOff", "FlyMonkDefenseAttackUnarmedOff", "MonkDefenseParryUnarmed", "FlyMonkDefenseParryUnarmed", "MonkDefenseReadyUnarmed", "FlyMonkDefenseReadyUnarmed", "MonkDefenseSpecialUnarmed", "FlyMonkDefenseSpecialUnarmed", "MonkHealAttackUnarmed", "FlyMonkHealAttackUnarmed", "MonkHealAttackUnarmedOff", "FlyMonkHealAttackUnarmedOff", "MonkHealParryUnarmed", "FlyMonkHealParryUnarmed", "MonkHealReadyUnarmed", "FlyMonkHealReadyUnarmed", "MonkHealSpecialUnarmed", "FlyMonkHealSpecialUnarmed", "FlyingKick", "FlyFlyingKick", "FlyingKickStart", "FlyFlyingKickStart", "FlyingKickEnd", "FlyFlyingKickEnd", "CraneStart", "FlyCraneStart", "CraneLoop", "FlyCraneLoop", "CraneEnd", "FlyCraneEnd", "Despawned", "FlyDespawned", "ThousandFists", "FlyThousandFists", "MonkHealReadySpellDirected", "FlyMonkHealReadySpellDirected", "MonkHealReadySpellOmni", "FlyMonkHealReadySpellOmni", "MonkHealSpellCastDirected", "FlyMonkHealSpellCastDirected", "MonkHealSpellCastOmni", "FlyMonkHealSpellCastOmni", "MonkHealChannelCastDirected", "FlyMonkHealChannelCastDirected", "MonkHealChannelCastOmni", "FlyMonkHealChannelCastOmni", "Torpedo", "FlyTorpedo", "Meditate", "FlyMeditate", "BreathOfFire", "FlyBreathOfFire", "RisingSunKick", "FlyRisingSunKick", "GroundKick", "FlyGroundKick", "KickBack", "FlyKickBack", "PetBattleStand", "FlyPetBattleStand", "PetBattleDeath", "FlyPetBattleDeath", "PetBattleRun", "FlyPetBattleRun", "PetBattleWound", "FlyPetBattleWound", "PetBattleAttack", "FlyPetBattleAttack", "PetBattleReadySpell", "FlyPetBattleReadySpell", "PetBattleSpellCast", "FlyPetBattleSpellCast", "PetBattleCustom0", "FlyPetBattleCustom0", "PetBattleCustom1", "FlyPetBattleCustom1", "PetBattleCustom2", "FlyPetBattleCustom2", "PetBattleCustom3", "FlyPetBattleCustom3", "PetBattleVictory", "FlyPetBattleVictory", "PetBattleLoss", "FlyPetBattleLoss", "PetBattleStun", "FlyPetBattleStun", "PetBattleDead", "FlyPetBattleDead", "PetBattleFreeze", "FlyPetBattleFreeze", "MonkOffenseAttackWeapon", "FlyMonkOffenseAttackWeapon", "BarTendEmoteWave", "FlyBarTendEmoteWave", "BarServerEmoteTalk", "FlyBarServerEmoteTalk", "BarServerEmoteWave", "FlyBarServerEmoteWave", "BarServerPourDrinks", "FlyBarServerPourDrinks", "BarServerPickup", "FlyBarServerPickup", "BarServerPutDown", "FlyBarServerPutDown", "BarSweepStand", "FlyBarSweepStand", "BarPatronSit", "FlyBarPatronSit", "BarPatronSitEmoteTalk", "FlyBarPatronSitEmoteTalk", "BarPatronStand", "FlyBarPatronStand", "BarPatronStandEmoteTalk", "FlyBarPatronStandEmoteTalk", "BarPatronStandEmotePoint", "FlyBarPatronStandEmotePoint", "CarrionSwarm", "FlyCarrionSwarm", "WheelLoop", "FlyWheelLoop", "StandCharacterCreate", "FlyStandCharacterCreate", "MountChopper", "FlyMountChopper", "FacePose", "FlyFacePose", "CombatAbility2HBig01", "FlyCombatAbility2HBig01", "CombatAbility2H01", "FlyCombatAbility2H01", "CombatWhirlwind", "FlyCombatWhirlwind", "CombatChargeLoop", "FlyCombatChargeLoop", "CombatAbility1H01", "FlyCombatAbility1H01", "CombatChargeEnd", "FlyCombatChargeEnd", "CombatAbility1H02", "FlyCombatAbility1H02", "CombatAbility1HBig01", "FlyCombatAbility1HBig01", "CombatAbility2H02", "FlyCombatAbility2H02", "ShaSpellPrecastBoth", "FlyShaSpellPrecastBoth", "ShaSpellCastBothFront", "FlyShaSpellCastBothFront", "ShaSpellCastLeftFront", "FlyShaSpellCastLeftFront", "ShaSpellCastRightFront", "FlyShaSpellCastRightFront", "ReadyCrossbow", "FlyReadyCrossbow", "LoadCrossbow", "FlyLoadCrossbow", "AttackCrossbow", "FlyAttackCrossbow", "HoldCrossbow", "FlyHoldCrossbow", "CombatAbility2HL01", "FlyCombatAbility2HL01", "CombatAbility2HL02", "FlyCombatAbility2HL02", "CombatAbility2HLBig01", "FlyCombatAbility2HLBig01", "CombatUnarmed01", "FlyCombatUnarmed01", "CombatStompLeft", "FlyCombatStompLeft", "CombatStompRight", "FlyCombatStompRight", "CombatLeapLoop", "FlyCombatLeapLoop", "CombatLeapEnd", "FlyCombatLeapEnd", "ShaReadySpellCast", "FlyShaReadySpellCast", "ShaSpellPrecastBothChannel", "FlyShaSpellPrecastBothChannel", "ShaSpellCastBothUp", "FlyShaSpellCastBothUp", "ShaSpellCastBothUpChannel", "FlyShaSpellCastBothUpChannel", "ShaSpellCastBothFrontChannel", "FlyShaSpellCastBothFrontChannel", "ShaSpellCastLeftFrontChannel", "FlyShaSpellCastLeftFrontChannel", "ShaSpellCastRightFrontChannel", "FlyShaSpellCastRightFrontChannel", "PriReadySpellCast", "FlyPriReadySpellCast", "PriSpellPrecastBoth", "FlyPriSpellPrecastBoth", "PriSpellPrecastBothChannel", "FlyPriSpellPrecastBothChannel", "PriSpellCastBothUp", "FlyPriSpellCastBothUp", "PriSpellCastBothFront", "FlyPriSpellCastBothFront", "PriSpellCastLeftFront", "FlyPriSpellCastLeftFront", "PriSpellCastRightFront", "FlyPriSpellCastRightFront", "PriSpellCastBothUpChannel", "FlyPriSpellCastBothUpChannel", "PriSpellCastBothFrontChannel", "FlyPriSpellCastBothFrontChannel", "PriSpellCastLeftFrontChannel", "FlyPriSpellCastLeftFrontChannel", "PriSpellCastRightFrontChannel", "FlyPriSpellCastRightFrontChannel", "MagReadySpellCast",
	"FlyMagReadySpellCast", "MagSpellPrecastBoth", "FlyMagSpellPrecastBoth", "MagSpellPrecastBothChannel", "FlyMagSpellPrecastBothChannel", "MagSpellCastBothUp", "FlyMagSpellCastBothUp", "MagSpellCastBothFront", "FlyMagSpellCastBothFront", "MagSpellCastLeftFront", "FlyMagSpellCastLeftFront", "MagSpellCastRightFront", "FlyMagSpellCastRightFront", "MagSpellCastBothUpChannel", "FlyMagSpellCastBothUpChannel", "MagSpellCastBothFrontChannel", "FlyMagSpellCastBothFrontChannel", "MagSpellCastLeftFrontChannel", "FlyMagSpellCastLeftFrontChannel", "MagSpellCastRightFrontChannel", "FlyMagSpellCastRightFrontChannel", "LocReadySpellCast", "FlyLocReadySpellCast", "LocSpellPrecastBoth", "FlyLocSpellPrecastBoth", "LocSpellPrecastBothChannel", "FlyLocSpellPrecastBothChannel", "LocSpellCastBothUp", "FlyLocSpellCastBothUp", "LocSpellCastBothFront", "FlyLocSpellCastBothFront", "LocSpellCastLeftFront", "FlyLocSpellCastLeftFront", "LocSpellCastRightFront", "FlyLocSpellCastRightFront", "LocSpellCastBothUpChannel", "FlyLocSpellCastBothUpChannel", "LocSpellCastBothFrontChannel", "FlyLocSpellCastBothFrontChannel", "LocSpellCastLeftFrontChannel", "FlyLocSpellCastLeftFrontChannel", "LocSpellCastRightFrontChannel", "FlyLocSpellCastRightFrontChannel", "DruReadySpellCast", "FlyDruReadySpellCast", "DruSpellPrecastBoth", "FlyDruSpellPrecastBoth", "DruSpellPrecastBothChannel", "FlyDruSpellPrecastBothChannel", "DruSpellCastBothUp", "FlyDruSpellCastBothUp", "DruSpellCastBothFront", "FlyDruSpellCastBothFront", "DruSpellCastLeftFront", "FlyDruSpellCastLeftFront", "DruSpellCastRightFront", "FlyDruSpellCastRightFront", "DruSpellCastBothUpChannel", "FlyDruSpellCastBothUpChannel", "DruSpellCastBothFrontChannel", "FlyDruSpellCastBothFrontChannel", "DruSpellCastLeftFrontChannel", "FlyDruSpellCastLeftFrontChannel", "DruSpellCastRightFrontChannel", "FlyDruSpellCastRightFrontChannel", "ArtMainLoop", "FlyArtMainLoop", "ArtDualLoop", "FlyArtDualLoop", "ArtFistsLoop", "FlyArtFistsLoop", "ArtBowLoop", "FlyArtBowLoop", "CombatAbility1H01Off", "FlyCombatAbility1H01Off", "CombatAbility1H02Off", "FlyCombatAbility1H02Off", "CombatFuriousStrike01", "FlyCombatFuriousStrike01", "CombatFuriousStrike02", "FlyCombatFuriousStrike02", "CombatFuriousStrikes", "FlyCombatFuriousStrikes", "CombatReadySpellCast", "FlyCombatReadySpellCast", "CombatShieldThrow", "FlyCombatShieldThrow", "PalSpellCast1HUp", "FlyPalSpellCast1HUp", "CombatReadyPostSpellCast", "FlyCombatReadyPostSpellCast", "PriReadyPostSpellCast", "FlyPriReadyPostSpellCast", "DHCombatRun", "FlyDHCombatRun", "CombatShieldBash", "FlyCombatShieldBash", "CombatThrow", "FlyCombatThrow", "CombatAbility1HPierce", "FlyCombatAbility1HPierce", "CombatAbility1HOffPierce", "FlyCombatAbility1HOffPierce", "CombatMutilate", "FlyCombatMutilate", "CombatBladeStorm", "FlyCombatBladeStorm", "CombatFinishingMove", "FlyCombatFinishingMove", "CombatLeapStart", "FlyCombatLeapStart", "GlvThrowMain", "FlyGlvThrowMain", "GlvThrownOff", "FlyGlvThrownOff", "DHCombatSprint", "FlyDHCombatSprint", "CombatAbilityGlv01", "FlyCombatAbilityGlv01", "CombatAbilityGlv02", "FlyCombatAbilityGlv02", "CombatAbilityGlvOff01", "FlyCombatAbilityGlvOff01", "CombatAbilityGlvOff02", "FlyCombatAbilityGlvOff02", "CombatAbilityGlvBig01", "FlyCombatAbilityGlvBig01", "CombatAbilityGlvBig02", "FlyCombatAbilityGlvBig02", "ReadyGlv", "FlyReadyGlv", "CombatAbilityGlvBig03", "FlyCombatAbilityGlvBig03", "DoubleJumpStart", "FlyDoubleJumpStart", "DoubleJump", "FlyDoubleJump", "CombatEviscerate", "FlyCombatEviscerate", "DoubleJumpLandRun", "FlyDoubleJumpLandRun", "BackFlipStart", "FlyBackFlipStart", "BackFlipLoop", "FlyBackFlipLoop", "FelRushLoop", "FlyFelRushLoop", "FelRushEnd", "FlyFelRushEnd", "DHToAlteredStart", "FlyDHToAlteredStart", "DHToAlteredEnd", "FlyDHToAlteredEnd", "DHGlide", "FlyDHGlide", "FanOfKnives", "FlyFanOfKnives", "SingleJumpStart", "FlySingleJumpStart", "DHBladeDance1", "FlyDHBladeDance1", "DHBladeDance2", "FlyDHBladeDance2", "DHBladeDance3", "FlyDHBladeDance3", "DHMeteorStrike", "FlyDHMeteorStrike", "CombatExecute", "FlyCombatExecute", "ArtLoop", "FlyArtLoop", "ParryGlv", "FlyParryGlv", "CombatUnarmed02", "FlyCombatUnarmed02", "CombatPistolShot", "FlyCombatPistolShot", "CombatPistolShotOff", "FlyCombatPistolShotOff", "Monk2HLIdle", "FlyMonk2HLIdle", "ArtShieldLoop", "FlyArtShieldLoop", "CombatAbility2H03", "FlyCombatAbility2H03", "CombatStomp", "FlyCombatStomp", "CombatRoar", "FlyCombatRoar", "PalReadySpellCast", "FlyPalReadySpellCast", "PalSpellPrecastRight", "FlyPalSpellPrecastRight", "PalSpellPrecastRightChannel", "FlyPalSpellPrecastRightChannel", "PalSpellCastRightFront", "FlyPalSpellCastRightFront", "ShaSpellCastBothOut", "FlyShaSpellCastBothOut", "AttackWeapon", "FlyAttackWeapon", "ReadyWeapon", "FlyReadyWeapon", "AttackWeaponOff", "FlyAttackWeaponOff", "SpecialDual", "FlySpecialDual", "DkCast1HFront", "FlyDkCast1HFront", "CastStrongRight", "FlyCastStrongRight", "CastStrongLeft", "FlyCastStrongLeft", "CastCurseRight", "FlyCastCurseRight", "CastCurseLeft", "FlyCastCurseLeft", "CastSweepRight", "FlyCastSweepRight", "CastSweepLeft", "FlyCastSweepLeft", "CastStrongUpLeft", "FlyCastStrongUpLeft", "CastTwistUpBoth", "FlyCastTwistUpBoth", "CastOutStrong", "FlyCastOutStrong", "DrumLoop", "FlyDrumLoop", "ParryWeapon", "FlyParryWeapon", "ReadyFL", "FlyReadyFL", "AttackFL", "FlyAttackFL", "AttackFLOff", "FlyAttackFLOff", "ParryFL", "FlyParryFL", "SpecialFL", "FlySpecialFL", "PriHoverForward", "FlyPriHoverForward", "PriHoverBackward", "FlyPriHoverBackward",
	"PriHoverRight", "FlyPriHoverRight", "PriHoverLeft", "FlyPriHoverLeft", "RunBackwards", "FlyRunBackwards", "CastStrongUpRight", "FlyCastStrongUpRight", "WAWalk", "FlyWAWalk", "WARun", "FlyWARun", "WADrunkStand", "FlyWADrunkStand", "WADrunkShuffleLeft", "FlyWADrunkShuffleLeft", "WADrunkShuffleRight", "FlyWADrunkShuffleRight", "WADrunkWalk", "FlyWADrunkWalk", "WADrunkWalkBackwards", "FlyWADrunkWalkBackwards", "WADrunkWound", "FlyWADrunkWound", "WADrunkTalk", "FlyWADrunkTalk", "WATrance01", "FlyWATrance01", "WATrance02", "FlyWATrance02", "WAChant01", "FlyWAChant01", "WAChant02", "FlyWAChant02", "WAChant03", "FlyWAChant03", "WAHang01", "FlyWAHang01", "WAHang02", "FlyWAHang02", "WASummon01", "FlyWASummon01", "WASummon02", "FlyWASummon02", "WABeggarTalk", "FlyWABeggarTalk", "WABeggarStand", "FlyWABeggarStand", "WABeggarPoint", "FlyWABeggarPoint", "WABeggarBeg", "FlyWABeggarBeg", "WASit01", "FlyWASit01", "WASit02", "FlyWASit02", "WASit03", "FlyWASit03", "WACrierStand01", "FlyWACrierStand01", "WACrierStand02", "FlyWACrierStand02", "WACrierStand03", "FlyWACrierStand03", "WACrierTalk", "FlyWACrierTalk", "WACrateHold", "FlyWACrateHold", "WABarrelHold", "FlyWABarrelHold", "WASackHold", "FlyWASackHold", "WAWheelBarrowStand", "FlyWAWheelBarrowStand", "WAWheelBarrowWalk", "FlyWAWheelBarrowWalk", "WAWheelBarrowRun", "FlyWAWheelBarrowRun", "WAHammerLoop", "FlyWAHammerLoop", "WACrankLoop", "FlyWACrankLoop", "WAPourStart", "FlyWAPourStart", "WAPourLoop", "FlyWAPourLoop", "WAPourEnd", "FlyWAPourEnd", "WAEmotePour", "FlyWAEmotePour", "WARowingStandRight", "FlyWARowingStandRight", "WARowingStandLeft", "FlyWARowingStandLeft", "WARowingRight", "FlyWARowingRight", "WARowingLeft", "FlyWARowingLeft", "WAGuardStand01", "FlyWAGuardStand01", "WAGuardStand02", "FlyWAGuardStand02", "WAGuardStand03", "FlyWAGuardStand03", "WAGuardStand04", "FlyWAGuardStand04", "WAFreezing01", "FlyWAFreezing01", "WAFreezing02", "FlyWAFreezing02", "WAVendorStand01", "FlyWAVendorStand01", "WAVendorStand02", "FlyWAVendorStand02", "WAVendorStand03", "FlyWAVendorStand03", "WAVendorTalk", "FlyWAVendorTalk", "WALean01", "FlyWALean01", "WALean02", "FlyWALean02", "WALean03", "FlyWALean03", "WALeanTalk", "FlyWALeanTalk", "WABoatWheel", "FlyWABoatWheel", "WASmithLoop", "FlyWASmithLoop", "WAScrubbing", "FlyWAScrubbing", "WAWeaponSharpen", "FlyWAWeaponSharpen", "WAStirring", "FlyWAStirring", "WAPerch01", "FlyWAPerch01", "WAPerch02", "FlyWAPerch02", "HoldWeapon", "FlyHoldWeapon", "WABarrelWalk", "FlyWABarrelWalk", "WAPourHold", "FlyWAPourHold", "CastStrong", "FlyCastStrong", "CastCurse", "FlyCastCurse", "CastSweep", "FlyCastSweep", "CastStrongUp", "FlyCastStrongUp", "WABoatWheelStand", "FlyWABoatWheelStand", "WASmithStand", "FlyWASmithStand", "WACrankStand", "FlyWACrankStand", "WAPourWalk", "FlyWAPourWalk", "FalconeerStart", "FlyFalconeerStart", "FalconeerLoop", "FlyFalconeerLoop", "FalconeerEnd", "FlyFalconeerEnd", "WADrunkDrink", "FlyWADrunkDrink", "WAStandEat", "FlyWAStandEat", "WAStandDrink", "FlyWAStandDrink", "WABound01", "FlyWABound01", "WABound02", "FlyWABound02", "CombatAbility1H03Off", "FlyCombatAbility1H03Off", "CombatAbilityDualWield01", "FlyCombatAbilityDualWield01", "WACradle01", "FlyWACradle01", "LocSummon", "FlyLocSummon", "LoadWeapon", "FlyLoadWeapon", "ArtOffLoop", "FlyArtOffLoop", "WADead01", "FlyWADead01", "WADead02", "FlyWADead02", "WADead03", "FlyWADead03", "WADead04", "FlyWADead04", "WADead05", "FlyWADead05", "WADead06", "FlyWADead06", "WADead07", "FlyWADead07", "GiantRun", "FlyGiantRun", "BarTendEmoteCheer", "FlyBarTendEmoteCheer", "BarTendEmoteTalkQuestion", "FlyBarTendEmoteTalkQuestion", "BarTendEmoteTalkExclamation", "FlyBarTendEmoteTalkExclamation", "BarTendWalk", "FlyBarTendWalk", "BartendShuffleLeft", "FlyBartendShuffleLeft", "BarTendShuffleRight", "FlyBarTendShuffleRight", "BarTendCustomSpell01", "FlyBarTendCustomSpell01", "BarTendCustomSpell02", "FlyBarTendCustomSpell02", "BarTendCustomSpell03", "FlyBarTendCustomSpell03", "BarServerEmoteCheer", "FlyBarServerEmoteCheer", "BarServerEmoteTalkQuestion", "FlyBarServerEmoteTalkQuestion", "BarServerEmoteTalkExclamation", "FlyBarServerEmoteTalkExclamation", "BarServerCustomSpell01", "FlyBarServerCustomSpell01", "BarServerCustomSpell02", "FlyBarServerCustomSpell02", "BarServerCustomSpell03", "FlyBarServerCustomSpell03", "BarPatronEmoteDrink", "FlyBarPatronEmoteDrink", "BarPatronEmoteCheer", "FlyBarPatronEmoteCheer", "BarPatronCustomSpell01", "FlyBarPatronCustomSpell01", "BarPatronCustomSpell02", "FlyBarPatronCustomSpell02", "BarPatronCustomSpell03", "FlyBarPatronCustomSpell03", "HoldDart", "FlyHoldDart", "ReadyDart", "FlyReadyDart", "AttackDart", "FlyAttackDart", "LoadDart", "FlyLoadDart", "WADartTargetStand", "FlyWADartTargetStand", "WADartTargetEmoteTalk", "FlyWADartTargetEmoteTalk", "BarPatronSitEmoteCheer", "FlyBarPatronSitEmoteCheer", "BarPatronSitCustomSpell01", "FlyBarPatronSitCustomSpell01", "BarPatronSitCustomSpell02", "FlyBarPatronSitCustomSpell02", "BarPatronSitCustomSpell03", "FlyBarPatronSitCustomSpell03", "BarPianoStand", "FlyBarPianoStand", "BarPianoEmoteTalk", "FlyBarPianoEmoteTalk", "WAHearthSit", "FlyWAHearthSit", "WAHearthSitEmoteCry", "FlyWAHearthSitEmoteCry", "WAHearthSitEmoteCheer", "FlyWAHearthSitEmoteCheer", "WAHearthSitCustomSpell01", "FlyWAHearthSitCustomSpell01", "WAHearthSitCustomSpell02", "FlyWAHearthSitCustomSpell02", "WAHearthSitCustomSpell03", "FlyWAHearthSitCustomSpell03", "WAHearthStand", "FlyWAHearthStand", "WAHearthStandEmoteCheer", "FlyWAHearthStandEmoteCheer",
	"WAHearthStandEmoteTalk", "FlyWAHearthStandEmoteTalk", "WAHearthStandCustomSpell01", "FlyWAHearthStandCustomSpell01", "WAHearthStandCustomSpell02", "FlyWAHearthStandCustomSpell02", "WAHearthStandCustomSpell03", "FlyWAHearthStandCustomSpell03", "WAScribeStart", "FlyWAScribeStart", "WAScribeLoop", "FlyWAScribeLoop", "WAScribeEnd", "FlyWAScribeEnd", "WAEmoteScribe", "FlyWAEmoteScribe", "Haymaker", "FlyHaymaker", "HaymakerPrecast", "FlyHaymakerPrecast", "ChannelCastOmniUp", "FlyChannelCastOmniUp", "DHJumpLandRun", "FlyDHJumpLandRun", "Cinematic01", "FlyCinematic01", "Cinematic02", "FlyCinematic02", "Cinematic03", "FlyCinematic03", "Cinematic04", "FlyCinematic04", "Cinematic05", "FlyCinematic05", "Cinematic06", "FlyCinematic06", "Cinematic07", "FlyCinematic07", "Cinematic08", "FlyCinematic08", "Cinematic09", "FlyCinematic09", "Cinematic10", "FlyCinematic10", "TakeOffStart", "FlyTakeOffStart", "TakeOffFinish", "FlyTakeOffFinish", "LandStart", "FlyLandStart", "LandFinish", "FlyLandFinish", "WAWalkTalk", "FlyWAWalkTalk", "WAPerch03", "FlyWAPerch03", "CarriageMountMoving", "FlyCarriageMountMoving", "TakeOffFinishFly", "FlyTakeOffFinishFly", "CombatAbility2HBig02", "FlyCombatAbility2HBig02", "MountWide", "FlyMountWide", "EmoteTalkSubdued", "FlyEmoteTalkSubdued", "WASit04", "FlyWASit04", "MountSummon", "FlyMountSummon", "EmoteSelfie", "FlyEmoteSelfie", "CustomSpell11", "FlyCustomSpell11", "CustomSpell12", "FlyCustomSpell12", "CustomSpell13", "FlyCustomSpell13", "CustomSpell14", "FlyCustomSpell14", "CustomSpell15", "FlyCustomSpell15", "CustomSpell16", "FlyCustomSpell16", "CustomSpell17", "FlyCustomSpell17", "CustomSpell18", "FlyCustomSpell18", "CustomSpell19", "FlyCustomSpell19", "CustomSpell20", "FlyCustomSpell20", "AdvFlyLeft", "FlyAdvFlyLeft", "AdvFlyRight", "FlyAdvFlyRight", "AdvFlyForward", "FlyAdvFlyForward", "AdvFlyBackward", "FlyAdvFlyBackward", "AdvFlyUp", "FlyAdvFlyUp", "AdvFlyDown", "FlyAdvFlyDown", "AdvFlyForwardGlide", "FlyAdvFlyForwardGlide", "AdvFlyRoll", "FlyAdvFlyRoll", "ProfCookingLoop", "FlyProfCookingLoop", "ProfCookingStart", "FlyProfCookingStart", "ProfCookingEnd", "FlyProfCookingEnd", "WACurious", "FlyWACurious", "WAAlert", "FlyWAAlert", "WAInvestigate", "FlyWAInvestigate", "WAInteraction", "FlyWAInteraction", "WAThreaten", "FlyWAThreaten", "WAReact01", "FlyWAReact01", "WAReact02", "FlyWAReact02", "AdvFlyRollStart", "FlyAdvFlyRollStart", "AdvFlyRollEnd", "FlyAdvFlyRollEnd", "EmpBreathPrecast", "FlyEmpBreathPrecast", "EmpBreathPrecastChannel", "FlyEmpBreathPrecastChannel", "EmpBreathSpellCast", "FlyEmpBreathSpellCast", "EmpBreathSpellCastChannel", "FlyEmpBreathSpellCastChannel", "DracFlyBreathTakeoffStart", "FlyDracFlyBreathTakeoffStart", "DracFlyBreathTakeoffFinish", "FlyDracFlyBreathTakeoffFinish", "DracFlyBreath", "FlyDracFlyBreath", "DracFlyBreathLandStart", "FlyDracFlyBreathLandStart", "DracFlyBreathLandFinish", "FlyDracFlyBreathLandFinish", "DracAirDashLeft", "FlyDracAirDashLeft", "DracAirDashForward", "FlyDracAirDashForward", "DracAirDashBackward", "FlyDracAirDashBackward", "DracAirDashRight", "FlyDracAirDashRight", "LivingWorldProximityEnter", "FlyLivingWorldProximityEnter", "AdvFlyDownEnd", "FlyAdvFlyDownEnd", "LivingWorldProximityLoop", "FlyLivingWorldProximityLoop", "LivingWorldProximityLeave", "FlyLivingWorldProximityLeave", "EmpAirBarragePrecast", "FlyEmpAirBarragePrecast", "EmpAirBarragePrecastChannel", "FlyEmpAirBarragePrecastChannel", "EmpAirBarrageSpellCast", "FlyEmpAirBarrageSpellCast", "DracClawSwipeLeft", "FlyDracClawSwipeLeft", "DracClawSwipeRight", "FlyDracClawSwipeRight", "DracHoverIdle", "FlyDracHoverIdle", "DracHoverLeft", "FlyDracHoverLeft", "DracHoverRight", "FlyDracHoverRight", "DracHoverBackward", "FlyDracHoverBackward", "DracHoverForward", "FlyDracHoverForward", "DracAttackWings", "FlyDracAttackWings", "DracAttackTail", "FlyDracAttackTail", "AdvFlyStart", "FlyAdvFlyStart", "AdvFlyLand", "FlyAdvFlyLand", "AdvFlyLandRun", "FlyAdvFlyLandRun", "AdvFlyStrafeLeft", "FlyAdvFlyStrafeLeft", "AdvFlyStrafeRight", "FlyAdvFlyStrafeRight", "AdvFlyIdle", "FlyAdvFlyIdle", "AdvFlyRollRight", "FlyAdvFlyRollRight", "AdvFlyRollRightEnd", "FlyAdvFlyRollRightEnd", "AdvFlyRollLeft", "FlyAdvFlyRollLeft", "AdvFlyRollLeftEnd", "FlyAdvFlyRollLeftEnd", "AdvFlyFlap", "FlyAdvFlyFlap", "DracHoverDracClawSwipeLeft", "FlyDracHoverDracClawSwipeLeft", "DracHoverDracClawSwipeRight", "FlyDracHoverDracClawSwipeRight", "DracHoverDracAttackWings", "FlyDracHoverDracAttackWings", "DracHoverReadySpellOmni", "FlyDracHoverReadySpellOmni", "DracHoverSpellCastOmni", "FlyDracHoverSpellCastOmni", "DracHoverChannelSpellOmni", "FlyDracHoverChannelSpellOmni", "DracHoverReadySpellDirected", "FlyDracHoverReadySpellDirected", "DracHoverChannelSpellDirected", "FlyDracHoverChannelSpellDirected", "DracHoverSpellCastDirected", "FlyDracHoverSpellCastDirected", "DracHoverCastOutStrong", "FlyDracHoverCastOutStrong", "DracHoverBattleRoar", "FlyDracHoverBattleRoar", "DracHoverEmpBreathSpellCast", "FlyDracHoverEmpBreathSpellCast", "DracHoverEmpBreathSpellCastChannel", "FlyDracHoverEmpBreathSpellCastChannel", "LivingWorldTimeOfDayEnter", "FlyLivingWorldTimeOfDayEnter", "LivingWorldTimeOfDayLoop", "FlyLivingWorldTimeOfDayLoop", "LivingWorldTimeOfDayLeave", "FlyLivingWorldTimeOfDayLeave", "LivingWorldWeatherEnter", "FlyLivingWorldWeatherEnter", "LivingWorldWeatherLoop", "FlyLivingWorldWeatherLoop", "LivingWorldWeatherLeave", "FlyLivingWorldWeatherLeave", "AdvFlyDownStart", "FlyAdvFlyDownStart", "AdvFlyFlapBig", "FlyAdvFlyFlapBig",
	"DracHoverReadyUnarmed", "FlyDracHoverReadyUnarmed", "DracHoverAttackUnarmed", "FlyDracHoverAttackUnarmed", "DracHoverParryUnarmed", "FlyDracHoverParryUnarmed", "DracHoverCombatWound", "FlyDracHoverCombatWound", "DracHoverCombatCritical", "FlyDracHoverCombatCritical", "DracHoverAttackTail", "FlyDracHoverAttackTail", "Glide", "FlyGlide", "GlideEnd", "FlyGlideEnd", "DracClawSwipe", "FlyDracClawSwipe", "DracHoverDracClawSwipe", "FlyDracHoverDracClawSwipe", "AdvFlyFlapUp", "FlyAdvFlyFlapUp", "AdvFlySlowFall", "FlyAdvFlySlowFall", "AdvFlyFlapFoward", "FlyAdvFlyFlapFoward", "DracSpellCastWings", "FlyDracSpellCastWings", "DracHoverDracSpellCastWings", "FlyDracHoverDracSpellCastWings", "DracAirDashVertical", "FlyDracAirDashVertical", "DracAirDashRefresh", "FlyDracAirDashRefresh", "SkinningLoop", "FlySkinningLoop", "SkinningStart", "FlySkinningStart", "SkinningEnd", "FlySkinningEnd", "AdvFlyForwardGlideSlow", "FlyAdvFlyForwardGlideSlow", "AdvFlyForwardGlideFast", "FlyAdvFlyForwardGlideFast" ];

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

		return this.read( parser, header );

	}

	read( parser, header ) {

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
		const boneCountMax = parser.readUInt32();

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

		header.palette = [];

		for ( let i = 0; i < 256; i ++ ) {

			// BGRA colors

			header.palette.push(
				parser.readUInt8(),
				parser.readUInt8(),
				parser.readUInt8(),
				parser.readUInt8()
			);

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
			texture.colorSpace = SRGBColorSpace;
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

		} else if ( header.preferredFormat === BLP_PIXEL_FORMAT_PIXEL_UNSPECIFIED ) {

			if ( header.colorEncoding === BLP_COLOR_ENCODING_COLOR_PALETTE ) {

				const newMips = [];

				for ( let i = 0; i < mipmaps.length; i ++ ) {

					const mip = mipmaps[ i ];

					const data = new Uint8Array( mip.width * mip.height * 4 );

					for ( let j = 0, k = 0; j < mip.data.length; j ++, k += 4 ) {

						const index = mip.data[ j ];

						data[ k + 0 ] = header.palette[ index * 4 + 2 ];
						data[ k + 1 ] = header.palette[ index * 4 + 1 ];
						data[ k + 2 ] = header.palette[ index * 4 + 0 ];
						data[ k + 3 ] = header.palette[ index * 4 + 3 ];

					}

					newMips.push( { data, width: mip.width, height: mip.height } );

				}

				texture = new DataTexture( newMips[ 0 ].data, header.width, header.height );
				texture.colorSpace = SRGBColorSpace;
				texture.mipmaps = newMips;
				texture.magFilter = LinearFilter;
				texture.minFilter = LinearMipmapLinearFilter;
				texture.needsUpdate = true;

			} else {

				// TODO Handle more unsupported color encodings

				console.error( 'THREE.M2Loader: Unsupported color encoding.', header.colorEncoding );

			}

		} else {

			// TODO Handle more unsupported pixel formats

			console.error( 'THREE.M2Loader: Unsupported pixel format.', header.preferredFormat );

		}

		//

		if ( flags & 0x1 ) texture.wrapS = RepeatWrapping;
		if ( flags & 0x2 ) texture.wrapT = RepeatWrapping;

		texture.name = url;

		return texture;

	}

}

// const BLP_COLOR_ENCODING_COLOR_JPEG = 0;
const BLP_COLOR_ENCODING_COLOR_PALETTE = 1;
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
const BLP_PIXEL_FORMAT_PIXEL_UNSPECIFIED = 8;
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

class SequenceManager {

	constructor( sequences, globalSequences, filename, resourcePath ) {

		this.sequences = sequences;
		this.globalSequences = globalSequences;
		this.filename = filename;
		this.resourcePath = resourcePath;

		this._sequenceMap = new Map();
		this._globalSequenceMap = new Map();
		this._mixers = new Map();
		this._globalMixers = new Map();
		this._externalSequences = new Map();
		this._externalSequencesInitialized = new Map();

		// setup maps

		for ( let i = 0; i < sequences.length; i ++ ) {

			const sequence = sequences[ i ];

			const key = computeSequenceKey( sequence.id, sequence.variationIndex );

			this._sequenceMap.set( key, [] );

			if ( ! this.isEmbeddedSequence( i ) ) {

				this._externalSequencesInitialized.set( key, false );
				this._externalSequences.set( key, [] );

			}

		}

		for ( let i = 0; i < globalSequences.length; i ++ ) {

			this._globalSequenceMap.set( i, [] );

		}

	}

	addAnimationToSequence( clip, root, i ) {

		const sequence = this.sequences[ i ];

		const key = computeSequenceKey( sequence.id, sequence.variationIndex );

		const animations = this._sequenceMap.get( key );
		animations.push( { clip, root, flags: sequence.flags } );

		if ( this._mixers.has( root ) === false ) {

			this._mixers.set( root, new AnimationMixer( root ) );

		}

	}

	addAnimationToGlobalSequence( clip, root, i ) {

		const globalSequence = this._globalSequenceMap.get( i );
		globalSequence.push( { clip, root } );

		if ( this._globalMixers.has( root ) === false ) {

			this._globalMixers.set( root, new AnimationMixer( root ) );

		}

	}

	addExternalTrack( id, subId, externalTimestamps, externalValues, track ) {

		const key = computeSequenceKey( id, subId );

		const data = this._externalSequences.get( key );

		data.push( { externalTimestamps, externalValues, track } );

	}

	isEmbeddedSequence( i ) {

		const sequence = this.sequences[ i ];

		return sequence.flags & M2_SEQUENCE_EMBEDDED_DATA;

	}

	playSequence( id, variationIndex = 0 ) {

		const key = computeSequenceKey( id, variationIndex );

		const sequence = this._sequenceMap.get( key );

		for ( const animation of sequence ) {

			const mixer = this._mixers.get( animation.root );

			if ( animation.flags & M2_SEQUENCE_EMBEDDED_DATA ) {

				const action = mixer.clipAction( animation.clip );
				action.play();

			} else {

				if ( this._externalSequencesInitialized.get( key ) === false ) {

					const filename = this.filename;
					const resourcePath = this.resourcePath;
					const sequenceId = id.toString().padStart( 4, '0' );
					const subSequenceId = variationIndex.toString().padStart( 2, '0' );

					const path = resourcePath + filename + sequenceId + '-' + subSequenceId + '.anim';

					fetch( path ).then( ( response ) => {

						if ( response.ok === false ) {

							console.warn( 'THREE.M2Loader: Unable to load animation file. HTTP error, response status:', response.status );
							return;

						}

						return response.arrayBuffer();

					} ).then( ( buffer ) => {

						if ( buffer !== undefined ) {

							this._updateKeyframes( id, variationIndex, buffer );
							this._externalSequencesInitialized.set( key, true );

							animation.clip.resetDuration();
							const action = mixer.clipAction( animation.clip );
							action.play();

						}

					} );

				} else {

					const action = mixer.clipAction( animation.clip );
					action.play();

				}

			}

		}

	}

	stopSequence( id, variationIndex = 0 ) {

		const key = computeSequenceKey( id, variationIndex );

		const sequence = this._sequenceMap.get( key );

		for ( const animation of sequence ) {

			const mixer = this._mixers.get( animation.root );
			mixer.stopAllAction();

		}

	}

	stopAllSequences() {

		for ( const mixer of this._mixers.values() ) {

			mixer.stopAllAction();

		}

	}

	playGlobalSequences() {

		for ( const globalSequence of this._globalSequenceMap.values() ) {

			for ( const animation of globalSequence ) {

				const mixer = this._globalMixers.get( animation.root );
				const action = mixer.clipAction( animation.clip );
				action.play();

			}

		}

	}

	stopGlobalSequences() {

		for ( const globalSequence of this._globalSequenceMap.values() ) {

			for ( const animation of globalSequence ) {

				const mixer = this._globalMixers.get( animation.root );
				mixer.stopAllAction();

			}

		}

	}

	listSequences() {

		const list = [];

		for ( const sequence of this.sequences ) {

			if ( sequence.variationIndex > 0 ) continue; // ignore variations

			const name = M2_ANIMATION_LIST[ sequence.id ];

			if ( name === undefined ) {

				console.warn( 'THREE.M2Loader: Unknown animation ID:', sequence.id );
				name = '';

			}

			list.push( {
				id: sequence.id,
				name: name

			} );

		}

		list.sort( compareId );

		return list;

	}

	listVariations( id ) {

		const list = [];

		for ( const sequence of this.sequences ) {

			if ( sequence.id === id ) list.push( sequence.variationIndex );

		}

		list.sort( compareNumber );

		return list;

	}

	hasGlobalSequences() {

		return this.globalSequences.length > 0;

	}

	update( delta ) {

		for ( const mixer of this._mixers.values() ) {

			mixer.update( delta );

		}

		for ( const mixer of this._globalMixers.values() ) {

			mixer.update( delta );

		}

	}

	_updateKeyframes( sequenceId, subSequenceId, buffer ) {

		const data = this._externalSequences.get( sequenceId + '-' + subSequenceId );

		const parser = new BinaryParser( buffer );
		parser.chunkOffset += 8; // TODO: Find out the purpose of the first 8 bytes

		for ( let keyframes of data ) {

			// times

			let length = keyframes.externalTimestamps.length;
			let offset = keyframes.externalTimestamps.offset;

			extractTimestamps( parser, length, offset, keyframes.track.times );

			// values

			length = keyframes.externalValues.length;
			offset = keyframes.externalValues.offset;
			const type = keyframes.externalValues.type;
			const itemSize = keyframes.externalValues.itemSize;

			extractValues( parser, length, offset, type, itemSize, keyframes.track.values );

		}

	}

}

function compareId( a, b ) {

	return a.id - b.id;


}

function compareNumber( a, b ) {

	return a - b;

}

function computeSequenceKey( sequenceId, variationIndex ) {

	return sequenceId + '-' + variationIndex;

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

class M2Sequence {

	constructor() {

		this.id = 0;
		this.variationIndex = 0;
		this.startTimestamp = 0;
		this.endTimestamp = 0;
		this.duration = 0;
		this.movespeed = 0;
		this.flags = 0;
		this.frequency = 0;
		this.padding = 0;
		this.replay = { minimum: 0, maximum: 0 };
		this.blendTime = 0;
		this.blendTimeIn = 0;
		this.blendTimeOut = 0;
		this.bounds = { extend: new Box3(), radius: 0 };
		this.variationNext = 0;
		this.aliasNext = 0;

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

		this.externalTimestamps = [];
		this.externalValues = [];

	}

}

class M2Vertex {

	constructor() {

		this.pos = new Vector3();
		this.boneWeights = new Vector4();
		this.boneIndices = new Vector4();
		this.normal = new Vector3();
		this.texCoords = [ new Vector2(), new Vector2() ];

	}

}

class PivotBone extends Bone {

	constructor() {

		super();

		this.pivot = new Vector3();

	}

	updateMatrix() {

		this.matrix.compose( this.position, this.quaternion, this.scale );

		const px = this.pivot.x;
		const py = this.pivot.y;
		const pz = this.pivot.z;

		const te = this.matrix.elements;

		te[ 12 ] += px - te[ 0 ] * px - te[ 4 ] * py - te[ 8 ] * pz;
		te[ 13 ] += py - te[ 1 ] * px - te[ 5 ] * py - te[ 9 ] * pz;
		te[ 14 ] += pz - te[ 2 ] * px - te[ 6 ] * py - te[ 10 ] * pz;

		this.matrixWorldNeedsUpdate = true;

	}

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
