// Game Variables
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 500, 1000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 15, -25);
camera.lookAt(0, 5, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowShadowMap;
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(50, 50, 50);
directionalLight.castShadow = true;
directionalLight.shadow.camera.left = -100;
directionalLight.shadow.camera.right = 100;
directionalLight.shadow.camera.top = 100;
directionalLight.shadow.camera.bottom = -100;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
scene.add(directionalLight);

// Ground
const groundGeometry = new THREE.PlaneGeometry(200, 200);
const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Game State
let gameState = {
    wallHealth: 100,
    maxWallHealth: 100,
    tanksDestroyed: 0,
    wave: 1,
    gameOver: false,
    gameOverReason: '',
    cannonCooldown: 0
};

let tanks = [];
let projectiles = [];
let cannonProjectile = null;

// Input
const keys = {
    w: false,
    a: false,
    s: false,
    d: false
};

document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w') keys.w = true;
    if (key === 'a') keys.a = true;
    if (key === 's') keys.s = true;
    if (key === 'd') keys.d = true;
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w') keys.w = false;
    if (key === 'a') keys.a = false;
    if (key === 's') keys.s = false;
    if (key === 'd') keys.d = false;
});

// Wall
class Wall {
    constructor() {
        this.health = 100;
        this.maxHealth = 100;
        this.bricks = [];
        this.position = new THREE.Vector3(0, 0, -30);
        this.createWall();
    }
    
    createWall() {
        const brickWidth = 2;
        const brickHeight = 2;
        const brickDepth = 2;
        const wallWidth = 24;
        const wallHeight = 14;
        
        for (let x = 0; x < wallWidth; x += brickWidth) {
            for (let y = 0; y < wallHeight; y += brickHeight) {
                const geometry = new THREE.BoxGeometry(brickWidth, brickHeight, brickDepth);
                const material = new THREE.MeshPhongMaterial({ color: 0xA0522D });
                const brick = new THREE.Mesh(geometry, material);
                brick.position.set(x - wallWidth/2, y + 1, this.position.z);
                brick.castShadow = true;
                brick.receiveShadow = true;
                brick.active = true;
                scene.add(brick);
                this.bricks.push(brick);
            }
        }
    }
    
    takeDamage(amount) {
        this.health -= amount;
        gameState.wallHealth = this.health;
        updateWallHealthBar();
        
        if (this.health <= 0) {
            endGame('WALL DESTROYED!', 'The tanks breached the wall!');
        }
    }
}

const wall = new Wall();

// Cannon - First Person
class Cannon {
    constructor() {
        this.position = new THREE.Vector3(0, 15, -24);
        this.moveSpeed = 30;
        
        // Create barrel group for aiming
        this.barrelGroup = new THREE.Group();
        
        // Barrel
        const barrelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 6, 32);
        const barrelMaterial = new THREE.MeshPhongMaterial({ color: 0x000000 });
        this.barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
        this.barrel.position.z = 3;
        this.barrel.castShadow = true;
        this.barrel.receiveShadow = true;
        this.barrelGroup.add(this.barrel);
        
        // Muzzle flash light
        this.muzzleLight = new THREE.PointLight(0xFFFF00, 0, 30);
        this.muzzleLight.position.set(0, 0, 6);
        this.barrelGroup.add(this.muzzleLight);
        
        scene.add(this.barrelGroup);
        
        this.horizontalAngle = 0;
        this.verticalAngle = 0;
    }
    
    update(deltaTime) {
        // Movement
        const moveVector = new THREE.Vector3();
        
        if (keys.w) moveVector.z -= this.moveSpeed * deltaTime;
        if (keys.s) moveVector.z += this.moveSpeed * deltaTime;
        if (keys.a) moveVector.x -= this.moveSpeed * deltaTime;
        if (keys.d) moveVector.x += this.moveSpeed * deltaTime;
        
        this.position.add(moveVector);
        
        // Clamp position to stay near wall
        this.position.x = Math.max(-20, Math.min(20, this.position.x));
        this.position.z = Math.max(-28, Math.min(-20, this.position.z));
        
        // Update camera and barrel position
        camera.position.copy(this.position);
        this.barrelGroup.position.copy(this.position);
        
        // Apply rotation to barrel
        this.barrelGroup.rotation.order = 'YXZ';
        this.barrelGroup.rotation.y = this.horizontalAngle;
        this.barrelGroup.rotation.x = this.verticalAngle;
    }
    
    aim(mouseX, mouseY) {
        // Convert mouse position to normalized coordinates
        const x = (mouseX / window.innerWidth) * 2 - 1;
        const y = -(mouseY / window.innerHeight) * 2 + 1;
        
        this.horizontalAngle = x * Math.PI / 2.5;
        this.verticalAngle = Math.max(-Math.PI / 6, Math.min(Math.PI / 3, y * Math.PI / 3));
    }
    
    fire() {
        if (gameState.cannonCooldown > 0) return;
        
        const startPos = this.position.clone();
        startPos.z += 6; // Muzzle position
        
        const direction = new THREE.Vector3(0, 0, 1);
        direction.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.verticalAngle);
        direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.horizontalAngle);
        
        cannonProjectile = new Projectile(startPos, direction, 80);
        gameState.cannonCooldown = 0.2;
        
        // Muzzle flash
        this.muzzleLight.intensity = 2;
        setTimeout(() => { this.muzzleLight.intensity = 0; }, 50);
    }
}

const cannon = new Cannon();

// Tank
class Tank {
    constructor(laneIndex) {
        this.group = new THREE.Group();
        this.laneIndex = laneIndex;
        this.position = new THREE.Vector3(-80, 0, -30 + laneIndex * 10);
        this.group.position.copy(this.position);
        this.velocity = new THREE.Vector3(25, 0, 0);
        this.health = 1;
        this.maxHealth = 1;
        this.fireRate = 2;
        this.fireCountdown = Math.random() * this.fireRate;
        this.distanceToWall = 200;
        
        // Hull
        const hullGeometry = new THREE.BoxGeometry(3, 2, 5);
        const hullMaterial = new THREE.MeshPhongMaterial({ color: 0x2F4F4F });
        const hull = new THREE.Mesh(hullGeometry, hullMaterial);
        hull.position.y = 1.5;
        hull.castShadow = true;
        hull.receiveShadow = true;
        this.group.add(hull);
        this.hull = hull;
        
        // Turret
        const turretGeometry = new THREE.CylinderGeometry(1, 1, 0.8, 32);
        const turretMaterial = new THREE.MeshPhongMaterial({ color: 0x1a1a1a });
        this.turret = new THREE.Mesh(turretGeometry, turretMaterial);
        this.turret.position.y = 2.5;
        this.turret.castShadow = true;
        this.turret.receiveShadow = true;
        this.group.add(this.turret);
        
        // Cannon barrel
        const barrelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 3, 32);
        const barrelMaterial = new THREE.MeshPhongMaterial({ color: 0x000000 });
        this.barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
        this.barrel.position.set(0, 2.5, 1.5);
        this.barrel.castShadow = true;
        this.barrel.receiveShadow = true;
        this.group.add(this.barrel);
        
        // Tracks
        for (let x of [-1.5, 1.5]) {
            const trackGeometry = new THREE.BoxGeometry(0.5, 0.8, 5);
            const trackMaterial = new THREE.MeshPhongMaterial({ color: 0x000000 });
            const track = new THREE.Mesh(trackGeometry, trackMaterial);
            track.position.set(x, 0.8, 0);
            track.castShadow = true;
            track.receiveShadow = true;
            this.group.add(track);
        }
        
        scene.add(this.group);
    }
    
    update(deltaTime) {
        this.group.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        this.distanceToWall = Math.abs(this.group.position.x - (-10));
        
        this.fireCountdown -= deltaTime;
        if (this.distanceToWall < 35 && this.fireCountdown <= 0) {
            this.fire();
            this.fireCountdown = this.fireRate;
        }
    }
    
    fire() {
        const direction = new THREE.Vector3(-1, 0, 0);
        const startPos = this.group.position.clone().add(new THREE.Vector3(0, 2, 0));
        projectiles.push(new Projectile(startPos, direction, 40, true));
    }
    
    takeDamage(amount) {
        this.health -= amount;
        if (this.health <= 0) {
            this.destroy();
            gameState.tanksDestroyed++;
        }
    }
    
    destroy() {
        scene.remove(this.group);
        tanks = tanks.filter(t => t !== this);
        updateStats();
    }
}

// Projectile
class Projectile {
    constructor(position, direction, speed, isTankFire = false) {
        this.position = position.clone();
        this.direction = direction.clone().normalize();
        this.speed = speed;
        this.isTankFire = isTankFire;
        this.lifetime = 30;
        
        const size = isTankFire ? 0.3 : 0.5;
        const color = isTankFire ? 0xFF6347 : 0xFFDD00;
        const geometry = new THREE.SphereGeometry(size, 16, 16);
        const material = new THREE.MeshPhongMaterial({ color: color, emissive: color });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
        this.mesh.position.copy(this.position);
        scene.add(this.mesh);
    }
    
    update(deltaTime) {
        const movement = this.direction.clone().multiplyScalar(this.speed * deltaTime);
        this.position.add(movement);
        this.mesh.position.copy(this.position);
        
        this.lifetime -= deltaTime;
        
        this.checkCollisions();
        
        return this.lifetime > 0;
    }
    
    checkCollisions() {
        if (this.isTankFire) {
            if (this.position.x > -15 && this.position.x < -5) {
                wall.takeDamage(20);
                this.lifetime = -1;
            }
        } else {
            for (let tank of tanks) {
                const distance = this.position.distanceTo(tank.group.position);
                if (distance < 4) {
                    tank.takeDamage(1);
                    
                    const knockbackDirection = tank.group.position.clone().sub(this.position).normalize();
                    tank.velocity = knockbackDirection.multiplyScalar(120);
                    
                    this.lifetime = -1;
                    break;
                }
            }
        }
    }
    
    destroy() {
        scene.remove(this.mesh);
    }
}

function spawnWave(waveNumber) {
    const tankCount = 2 + waveNumber;
    for (let i = 0; i < tankCount; i++) {
        tanks.push(new Tank(i));
    }
    updateStats();
}

// Input handling
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;

document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    cannon.aim(mouseX, mouseY);
});

document.addEventListener('click', () => {
    cannon.fire();
});

// Update UI
function updateWallHealthBar() {
    const percent = Math.max(0, (gameState.wallHealth / gameState.maxWallHealth) * 100);
    document.getElementById('healthFill').style.width = percent + '%';
    document.getElementById('healthText').textContent = `${Math.ceil(gameState.wallHealth)}/100`;
}

function updateStats() {
    document.getElementById('tanksDestroyed').textContent = gameState.tanksDestroyed;
    document.getElementById('tanksRemaining').textContent = tanks.length;
    document.getElementById('wave').textContent = gameState.wave;
}

function endGame(title, text) {
    gameState.gameOver = true;
    document.getElementById('gameOverTitle').textContent = title;
    document.getElementById('gameOverText').textContent = text;
    document.getElementById('gameOver').style.display = 'block';
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Game loop
const clock = new THREE.Clock();
spawnWave(gameState.wave);

function animate() {
    requestAnimationFrame(animate);
    
    const deltaTime = clock.getDelta();
    
    if (gameState.gameOver) {
        renderer.render(scene, camera);
        return;
    }
    
    // Update cannon
    cannon.update(deltaTime);
    
    if (gameState.cannonCooldown > 0) {
        gameState.cannonCooldown -= deltaTime;
    }
    
    // Update tanks
    for (let tank of tanks) {
        tank.update(deltaTime);
    }
    
    // Update projectiles
    let projectilesToRemove = [];
    for (let i = projectiles.length - 1; i >= 0; i--) {
        if (!projectiles[i].update(deltaTime)) {
            projectilesToRemove.push(i);
        }
    }
    
    for (let i of projectilesToRemove.reverse()) {
        projectiles[i].destroy();
        projectiles.splice(i, 1);
    }
    
    // Update cannon projectile
    if (cannonProjectile) {
        if (!cannonProjectile.update(deltaTime)) {
            cannonProjectile.destroy();
            cannonProjectile = null;
        }
    }
    
    // Check if wave is cleared
    if (tanks.length === 0 && !gameState.gameOver) {
        gameState.wave++;
        spawnWave(gameState.wave);
    }
    
    updateWallHealthBar();
    
    renderer.render(scene, camera);
}

animate();
