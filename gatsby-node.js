const Promise = require('bluebird');
const ContentAPI = require('./content-api');

const { PostNode, PageNode, TagNode, AuthorNode, SettingsNode, fakeNodes } = require('./ghost-nodes');
const { createRemoteFileNode } = require('gatsby-source-filesystem');

/**
 * Create Live Ghost Nodes
 * Uses the Ghost Content API to fetch all posts, pages, tags, authors and settings
 * Creates nodes for each record, so that they are all available to Gatsby
 */
const createLiveGhostNodes = async ({ actions, createNodeId, store, cache }, configOptions) => {
    const { createNode, createNodeField } = actions;
    let pages, posts;

    const downloadImageAndCreateFileNode = async ({ feature_image, id }, { createNode, createNodeId, store, cache }) => {
        let fileNode;
    
        try {
            fileNode = await createRemoteFileNode({
                url: feature_image,
                parentNodeId: id,
                store,
                cache,
                createNode,
                createNodeId,
                name: 'image'
            });

            await createNodeField({
                node: fileNode,
                name: 'originalPath',
                value: feature_image,
            });

            await createNodeField({
                node: fileNode,
                name: 'refId',
                value: id,
            });
        } catch (err) {
            console.warn('Error creating node', err);
        }
    
        return fileNode;
    };

    const api = ContentAPI.configure(configOptions);

    const postAndPageFetchOptions = {
        limit: 'all',
        include: 'tags,authors',
        formats: 'html,plaintext'
    };

    const fetchPosts = api.posts.browse(postAndPageFetchOptions).then((ghostPosts) => {
        posts = ghostPosts;
    });

    const fetchPages = api.pages.browse(postAndPageFetchOptions).then((ghostPages) => {
        pages = ghostPages;
    });

    const tagAndAuthorFetchOptions = {
        limit: 'all',
        include: 'count.posts'
    };

    const fetchTags = api.tags.browse(tagAndAuthorFetchOptions).then((tags) => {
        tags.forEach((tag) => {
            tag.postCount = tag.count.posts;
            createNode(TagNode(tag));
        });
    });

    const fetchAuthors = api.authors.browse(tagAndAuthorFetchOptions).then((authors) => {
        authors.forEach((author) => {
            author.postCount = author.count.posts;
            createNode(AuthorNode(author));
        });
    });

    const fetchSettings = api.settings.browse().then((setting) => {
        // The settings object doesn't have an id, prevent Gatsby from getting 'undefined'
        setting.id = 1;
        createNode(SettingsNode(setting));
    });

    return await Promise.all([fetchPosts, fetchPages, fetchTags, fetchAuthors, fetchSettings])
        .then(async () => {
            await Promise.all(
                posts.map(async (post) => {
                    if (post.feature_image) {
                        post.image = await downloadImageAndCreateFileNode(post, { createNode, createNodeId, store, cache });
            
                        post.localFile___NODE = post.image.id;
                    }
            
                    return createNode(PostNode(post));
                }),
                pages.map(async (page) => {
                    if (page.feature_image) {
                        page.image = await downloadImageAndCreateFileNode(page, { createNode, createNodeId, store, cache });

                        page.localFile___NODE = page.image.id;
                    }
            
                    return createNode(PageNode(page));
                })
            );
        });
};

/**
 * Create Temporary Fake Nodes
 * Refs: https://github.com/gatsbyjs/gatsby/issues/10856#issuecomment-451701011
 * Ensures that Gatsby knows about every field in the Ghost schema
 */
const createTemporaryFakeNodes = ({emitter, actions}) => {
    // Setup our temporary fake nodes
    fakeNodes.forEach((node) => {
        // createTemporaryFakeNodes is called twice. The second time, the node already has an owner
        // This triggers an error, so we clean the node before trying again
        delete node.internal.owner;
        actions.createNode(node);
    });

    const onSchemaUpdate = () => {
        // Destroy our temporary fake nodes
        fakeNodes.forEach((node) => {
            actions.deleteNode({node});
        });
        emitter.off(`SET_SCHEMA`, onSchemaUpdate);
    };

    // Use a Gatsby internal API to cleanup our Fake Nodes
    emitter.on(`SET_SCHEMA`, onSchemaUpdate);
};

// Standard way to create nodes
exports.sourceNodes = async ({emitter, actions, createNodeId, store, cache}, configOptions) => {
    // These temporary nodes ensure that Gatsby knows about every field in the Ghost Schema
    createTemporaryFakeNodes({emitter, actions, store, cache});

    // Go and fetch live data, and populate the nodes
    const nodes = createLiveGhostNodes({actions, createNodeId, store, cache}, configOptions);

    return nodes;
};

// Secondary point in build where we have to create fake Nodes
exports.onPreExtractQueries = ({emitter, actions, store, cache}) => {
    createTemporaryFakeNodes({emitter, actions, store, cache});
};
