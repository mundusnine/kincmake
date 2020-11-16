import * as idl from 'webidl2';
import {Language} from './Language';
import * as path from 'path';

export class BeefLang extends Language {
	constructor() {
		super();
	}
	async exportWrapper(tree: idl.IDLRootType[], from: string, to: string, options: any, filename: string ): Promise<void> {
		let p = filename.split('/');
		filename = p[p.length - 1].replace('.idl', '.bf');
		console.log(filename);
		this.writeFile(path.resolve(to, filename));
		this.p('using System;');
		this.p('using System.Interop;');
		this.p('using System.FFI;');
		this.p('\n');
		filename = filename.replace('.bf', '');
		let firstLetter = filename.charAt(0);

		let defaultClassname = filename.replace(firstLetter, firstLetter.toUpperCase()); 

		this.p('namespace ' + filename + '_beef\n{');
		let indent = 1;
		for (let node of tree) {
			let type = node.type.toString();
			this.p('', indent);
			switch (type) {
				case 'callback':
					let callback = <idl.CallbackType> node;
					let ret = this.toLangType(callback.idlType.idlType.toString());
					let line = 'typealias ' + callback.name + ' = function ' + ret + '(';
					for (let arg of callback.arguments) {
						let out = this.checkAttributes(arg.extAttrs);
						let type = !arg.optional ? this.toLangType(arg.idlType.idlType.toString()) + out.isRef : 'Nullable<' + this.toLangType(arg.idlType.idlType.toString()) + out.isRef + '>';
						line += out.line;
						line += ' ' + type + ' ' + arg.name + ', ';
					}
					if (callback.arguments.length > 0)
						line = line.slice(0, -1).slice(0, -1);
					line += ');'; 
					this.p(line, indent);
					break;
				case 'typedef':
					let typedef = <idl.TypedefType> node;
					if (typedef.name.endsWith('Array')) {
						break;
					}
					this.p('typealias ' + typedef.name + ' = '  + this.toLangType(typedef.idlType.idlType.toString()) + ';', indent);
					break;
				case 'enum':
					let n = <idl.EnumType> node;
					let enumType = 'int32';
					for (let attr of n.extAttrs) {
						if ( attr.name === 'ToUInt32') {
							enumType = 'uint32';
						}
					}
					this.p('public enum ' + n.name + ' : ' +  enumType + ' {', indent);
					indent = 2;
					for (let val of n.values) {
						this.p(val.value + ',', indent);
					}
					indent = 1;
					this.p('}', indent);
					break;
				case 'interface':
					let struct = <idl.InterfaceType> node;
					let ext = struct.inheritance !== null ? ' : ' + struct.inheritance : '';
					let interfDef = this.checkAttributes(struct.extAttrs);
					let structType = interfDef.isClass ? 'class' : 'struct';
					if (!interfDef.isClass)
						this.p('[CRepr]', indent);
					this.p(structType + ' ' + struct.name + ext + '\n	{', indent);
					indent = 2;
					for (let member of struct.members) {
						if (member.type === 'attribute') {
							let attr = <idl.AttributeMemberType> member;
							let type = this.toLangType(attr.idlType.idlType.toString());
							let out = this.checkAttributes(attr.extAttrs);
							let replace = out.StaticSize > 0 ? '' + out.StaticSize : ''; 
							type = type.replace('$n', replace);
							type += out.isRef;
							let attrName = attr.name;
							if (interfDef.isClass) {
								let lname = out.Linkname.length > 0 ? '__imp_' + out.Linkname + attr.name : '__imp_' + filename + '_' + struct.name + '_' + attr.name;
								this.p('[LinkName(\"' + lname.toLowerCase() + '\")]', indent);
							}
							let access = out.isPrivate ? '' : 'public ';
							let first = !interfDef.isClass ? '' :  access + 'static extern ';
							this.p(first + type + ' ' + attrName + ';', indent);
						}
						else if (member.type === 'operation') {
							let opr = <idl.OperationMemberType> member;
							let oprDef = this.checkAttributes(opr.extAttrs);
							let retIsRef = oprDef.isRef;
							let isGetOrSet = member.special === 'getter' || member.special === 'setter'; 
							let front = isGetOrSet ? 'public static ' : 'public static extern ';
							let funcName = opr.name;
							let line = front + this.toLangType(opr.idlType.idlType.toString()) + retIsRef + ' ' + funcName + '(';
							for (let arg of opr.arguments) {
								let type = !arg.optional ? this.toLangType(arg.idlType.idlType.toString()) : 'Nullable<' + this.toLangType(arg.idlType.idlType.toString()) + '>';
								let out = this.checkAttributes(arg.extAttrs);
								line += out.line;
								let isRef = type.indexOf('*') >= 0  || type.indexOf('Func') >= 0 ? '' : out.isRef;
								let pos = type.indexOf('>');
								if (pos >= 0 && isRef === '*') {
									type = type.replace('>', isRef + '>');
									isRef = '';
								}
								line += ' ' + type + isRef + ' ' + arg.name + ', ';
							}
							if (opr.arguments.length > 0)
								line = line.slice(0, -1).slice(0, -1);
							line += isGetOrSet ? '){' : ');';
							let lname = struct.name !== defaultClassname && !interfDef.ExcludeName ? filename + '_' + struct.name + '_' : filename + '_';
							lname = oprDef.Linkname.length > 0 ? interfDef.ExcludeName ? oprDef.Linkname : oprDef.Linkname + struct.name + '_' : lname;
							if (interfDef.isClass && !isGetOrSet)
								this.p('[LinkName(\"' + lname.toLowerCase() + opr.name + '\")]', indent);
							this.p(line, indent);
							if (isGetOrSet) {
								if (member.special === 'getter') {
									funcName = funcName.replace('get_', '');
									this.p('return *' + funcName + ';', indent + 1);
								}
								else if (member.special === 'setter') {
									funcName = funcName.replace('set_', '');
									let arg = opr.arguments[0];
									this.p('#unwarn// Don\'t warn when we don\'t use the function', indent + 1);
									this.p('*' + funcName + ' = ' + arg.name + ';', indent + 1);
								}
								this.p('}', indent);
							}
							this.p('', indent);
						}
					}
					indent = 1;
					this.p('}', indent);
			}
			if (type === 'eof') {
				break;
			}
		}
		this.p('}');
	}
	checkAttributes(attrs: idl.ExtendedAttribute[]) {
		let isRef: string = '';
		let lines = '';
		let isClass = false;
		let isPrivate = false;
		let Linkname: string = '';
		let StaticSize = 0;
		let ExcludeName = false;
		for (let attr of attrs) {
			if (attr.name === 'Value') continue;
			if (attr.name === 'Ref') {isRef += '*'; continue; }
			if (attr.name === 'Linkname') {
				Linkname = attr.rhs.value as string;
				// We need to replace twice because it doesn't find all " to replace
				Linkname = Linkname.replace('"', '').replace('"', '');
				continue;
			}
			if (attr.name === 'Private') {
				isPrivate = true;
				continue;
			}
			if (attr.name === 'Class') {
				isClass = true;
				continue;
			}
			if (attr.name === 'ExcludeName') {
				ExcludeName = true;
				continue;
			}
			if (attr.name === 'StaticSize') {
				StaticSize = parseInt(attr.rhs.value as string);
				continue;
			}
			lines += ' ' + attr.name.toLowerCase();
		}
		return { line: lines , isRef: isRef, isClass: isClass, isPrivate: isPrivate, Linkname: Linkname, StaticSize: StaticSize, ExcludeName: ExcludeName};
	}
	toLangType(idlType: string): string {
		switch (idlType) {
			case 'boolean':
				return 'bool';
			case 'byte':
				return 'int8';
			case 'DOMString':
				return 'char8*';
			case 'USVString':
				return 'c_wchar*';	
			case 'octet':
				return 'uint8';
			case 'VoidPtr':
				return 'void*';
			case 'any':
				return 'void*';	
			case 'long':
				return 'int32';
			case 'int':
				return 'int32';
			case 'short':
				return 'int16';
			case 'unsigned short':
				return 'c_ushort';
			case 'unsigned long':
				return 'c_ulong';
			case 'long long':
				return 'c_longlong';
			case 'void' || 'double' || 'float':
				return idlType;
			case 'Int8Array': 
				return 'int8[$n]';
			case 'Int16Array': 
				return 'int16[$n]';
			case 'Int32Array': 
				return 'int32[$n]';
			case 'Uint8Array': 
				return 'uint8[$n]';
			case 'Uint16Array': 
				return 'uint16[$n]';
			case 'Uint32Array': 
				return 'uint16[$n]';
			case 'Float32Array': 
				return 'float[$n]';
			case 'Float64Array': 
				return 'double[$n]';
			default:
				let out = idlType;
				if (idlType.endsWith('Array')) {
					out = idlType.replace('Array', '[$n]');
				}
				return out;
		}
		return '';
	}
}
