
Test Task for the NodeJS Developer Position

Context
Task Overview
App Functionality:
Important Things to Consider
Third-party Service
Tech Requirements
Deliverables
Context
We want to see if you can ship product, not just write code. Can you scope a fuzzy problem, pick fast tools, use AI well, and end up with something that works? Use any AI tools you like (Claude Code, Codex, Cursor). If you need it, we'll cover a $20 Claude or Codex subscription for the month. Treat it like real startup work: rough brief, limited time, ship something we can try.

Task Overview
You need to develop the frontend and backend of a web application. The main focus should be on the backend part

The application with all its dependencies must be wrapped in Docker Compose

The web application must be accessible via a link

App Functionality:
The application allows users to see a feed of images based on the user's text query. A third-party service is used as the data source.

The feed consists of several items, one below another. Each item in the feed consists of 2 posts, one on the left, one on the right. Each post represents an image and a list of tags retrieved for that image.

The user enters the query text and clicks submit. This action triggers 2 requests from the backend to the third-party service. One request is the entered text, the second is the entered text plus the word "graffiti". The data received from the third-party service should be transformed into the feed on the backend side. The feed from the backend should contain an array of items. Each item containing 2 related posts.

For example, the user entered "cat". Then we send 2 requests for third-party service — "cat" for the left posts (L1, L2, ..) and "cat graffiti" for the right ones (R1, R2, ..). This should form a feed like:
L1 R1
L2 R2
L3 R3
...

After the query, the user must be able to reload the page and — without sending a request to the third-party service — get the current state of the requested feed from the backend.

Important Things to Consider
The feed structure must be formed on the backend side

You need to take into account that the request from the backend to the third-party service may take longer than the timeout of the request from the frontend to the backend

If one of the feed requests has already returned a result, but the other has not — you need to show the posts from the request that responded, while showing the user that the second request has not finished yet

You need to implement request caching on the backend — if we have loaded posts for a query no older than 1 hour, return them without making a request to the third-party service

Third-party Service
OpenAPI: https://service.test.elvetech.io/openapi.json

Swagger: https://service.test.elvetech.io/docs

The service has rate limits

Tech Requirements
The task should be done using NodeJS / TypeScript. The rest of the stack is your choice

Feel free to utilize any AI tools you find helpful

You can use any open-source frameworks or libraries but be prepared to reason your choices

Deliverables
A link to the web application

A github repository with source code (public or shared by request)
