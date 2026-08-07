import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

// Helper to find our portable java
async function getJavaExecutable() {
    try {
        const cwd = process.cwd();
        const jdkRoot = path.join(cwd, '.jdk');
        const items = await fs.readdir(jdkRoot);
        for (const item of items) {
            if (item.startsWith('jdk-')) {
                return path.join(jdkRoot, item, 'bin', 'java.exe');
            }
        }
    } catch (e) {}
    return 'java';
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { language, files } = body;
        
        if (!files || files.length === 0) {
            return NextResponse.json({ run: { output: 'No files provided', stderr: '' } });
        }
        
        const code = files[0].content;
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'execute-'));
        
        let output = '';
        let stderr = '';
        
        try {
            if (language === 'html') {
                return NextResponse.json({ run: { output: 'HTML execution is handled natively by the browser. You can safely send this boilerplate to the controller.', stderr: '' } });
            }
            else if (language === 'python') {
                const filePath = path.join(tempDir, 'script.py');
                await fs.writeFile(filePath, code);
                const { stdout, stderr: err } = await execAsync(`python "${filePath}"`, { timeout: 5000 });
                output = stdout;
                stderr = err;
            } else if (language === 'javascript' || language === 'typescript') {
                const filePath = path.join(tempDir, 'script.js');
                await fs.writeFile(filePath, code);
                const { stdout, stderr: err } = await execAsync(`node "${filePath}"`, { timeout: 5000 });
                output = stdout;
                stderr = err;
            } else if (language === 'c' || language === 'cpp') {
                const ext = language === 'c' ? 'c' : 'cpp';
                const compiler = language === 'c' ? 'gcc' : 'g++';
                const filePath = path.join(tempDir, `main.${ext}`);
                const outPath = path.join(tempDir, 'a.exe');
                await fs.writeFile(filePath, code);
                await execAsync(`${compiler} "${filePath}" -o "${outPath}"`, { timeout: 10000 });
                const { stdout, stderr: err } = await execAsync(`"${outPath}"`, { timeout: 5000 });
                output = stdout;
                stderr = err;
            } else if (language === 'rust') {
                const filePath = path.join(tempDir, 'main.rs');
                const outPath = path.join(tempDir, 'main.exe');
                await fs.writeFile(filePath, code);
                await execAsync(`rustc "${filePath}" -o "${outPath}"`, { timeout: 10000 });
                const { stdout, stderr: err } = await execAsync(`"${outPath}"`, { timeout: 5000 });
                output = stdout;
                stderr = err;
            } else if (language === 'go') {
                const filePath = path.join(tempDir, 'main.go');
                await fs.writeFile(filePath, code);
                const { stdout, stderr: err } = await execAsync(`go run "${filePath}"`, { timeout: 10000 });
                output = stdout;
                stderr = err;
            } else if (language === 'java') {
                const filePath = path.join(tempDir, 'Main.java');
                await fs.writeFile(filePath, code);
                const javaExe = await getJavaExecutable();
                const { stdout, stderr: err } = await execAsync(`"${javaExe}" "${filePath}"`, { timeout: 10000 });
                output = stdout;
                stderr = err;
            } else {
                return NextResponse.json({ run: { output: `Local execution for ${language} is not configured on this machine.`, stderr: '' } });
            }
        } catch (execError: any) {
            stderr = execError.message || execError.stderr || 'Execution Error';
            output = execError.stdout || '';
            
            // Clean up common "command not found" errors for user-friendliness
            if (stderr.includes('is not recognized as an internal or external command') || stderr.includes('command not found')) {
                const toolName = stderr.split("'")[1] || stderr.split(' ')[0] || language;
                stderr = `Error: Compiler/runtime '${toolName}' is not installed or not added to your system PATH.\nTo run ${language.toUpperCase()} code locally, please install the appropriate toolchain.`;
            }
        }
        
        // Cleanup temp dir
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (e) {}

        return NextResponse.json({ run: { output: output + (stderr ? '\n[STDERR]:\n' + stderr : ''), stderr } });
    } catch (error: any) {
        return NextResponse.json({ run: { output: '', stderr: error.message } }, { status: 500 });
    }
}
